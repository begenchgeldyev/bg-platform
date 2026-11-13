import { afterAll, describe, expect, test } from 'bun:test';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { AskController } from '../ask/ask.controller';
import { createRateLimiter } from '../http/rate-limit';
import { type AskChat, createAskChat, plainTextHistory } from './ask-chat';

const model = new MockLanguageModelV4({
  doStream: async () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start' as const, warnings: [] },
        { type: 'text-start' as const, id: 't1' },
        ...['Begench ', 'builds ', 'web apps.'].map((delta) => ({ type: 'text-delta' as const, id: 't1', delta })),
        { type: 'text-end' as const, id: 't1' },
        {
          type: 'finish' as const,
          finishReason: { unified: 'stop' as const, raw: 'stop' },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 3, text: 3, reasoning: 0 },
          },
        },
      ],
    }),
  }),
});

const servers: { stop(force?: boolean): unknown }[] = [];
afterAll(() => {
  for (const server of servers) server.stop(true);
});

function chatAgainstServer(limit: number, chatModel = model): AskChat {
  const controller = new AskController({
    model: chatModel,
    rateLimiter: createRateLimiter({ limit, windowMs: 60_000 }),
    loadCvText: async () => 'CV',
  });
  const server = Bun.serve({ port: 0, routes: { '/api/ask': { POST: (req) => controller.handle(req, 'test') } } });
  servers.push(server);
  return createAskChat({ api: new URL('/api/ask', server.url).href });
}

function ask(chat: AskChat, question: string) {
  return new Promise<{ texts: string[]; error?: string }>((resolve) => {
    const texts: string[] = [];
    chat.ask(question, {
      onText: (text) => texts.push(text),
      onDone: () => resolve({ texts }),
      onError: (error) => resolve({ texts, error }),
    });
  });
}

describe('createAskChat', () => {
  test('streams the answer and sends earlier turns with the next question', async () => {
    const chat = chatAgainstServer(10);
    const first = await ask(chat, 'What does Begench do?');
    expect(first.error).toBeUndefined();
    expect(first.texts.at(-1)).toBe('Begench builds web apps.');
    expect(first.texts).toContain('Begench builds ');
    await ask(chat, 'Since when?');
    expect(model.doStreamCalls.at(-1)?.prompt.map((entry) => entry.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  test('drops a turn that failed mid-stream so the next question starts from a clean history', async () => {
    const flaky = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start' as const, warnings: [] },
              { type: 'text-start' as const, id: 't1' },
              { type: 'text-delta' as const, id: 't1', delta: 'Partial' },
              { type: 'error' as const, error: new Error('provider failed') },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start' as const, warnings: [] },
              { type: 'text-start' as const, id: 't1' },
              { type: 'text-delta' as const, id: 't1', delta: 'Recovered.' },
              { type: 'text-end' as const, id: 't1' },
              {
                type: 'finish' as const,
                finishReason: { unified: 'stop' as const, raw: 'stop' },
                usage: {
                  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
              },
            ],
          }),
        },
      ],
    });
    const chat = chatAgainstServer(10, flaky);
    const failed = await ask(chat, 'first');
    expect(failed.error).toBe('the assistant is unavailable');
    const retried = await ask(chat, 'second');
    expect(retried.texts.at(-1)).toBe('Recovered.');
    expect(flaky.doStreamCalls[1].prompt.map((entry) => entry.role)).toEqual(['system', 'user']);
  });

  test('reports the safe rate-limit message and is ready for the next question', async () => {
    const chat = chatAgainstServer(1);
    await ask(chat, 'first');
    const failed = await ask(chat, 'second');
    expect(failed.error).toBe('rate limit reached, try again in a few minutes');
    expect(chat.busy()).toBe(false);
  });

  test('reports the safe question-length validation message and rolls back the failed turn', async () => {
    const chat = chatAgainstServer(10);
    expect((await ask(chat, 'x'.repeat(501))).error).toBe('questions are limited to 500 characters');
    expect(chat.busy()).toBe(false);
    const recovered = await ask(chat, 'A valid question');
    expect(recovered.error).toBeUndefined();
    expect(model.doStreamCalls.at(-1)?.prompt.map((entry) => entry.role)).toEqual(['system', 'user']);
  });

  test('does not relay unknown messages, mismatched status/message pairs, malformed JSON or HTML', async () => {
    const cases: [number, unknown][] = [
      [429, { error: 'SECRET <img src=x>' }],
      [400, { error: 'questions are limited to 500 characters <script>SECRET</script>' }],
      [400, { error: 'rate limit reached, try again in a few minutes' }],
      [429, { error: 'questions are limited to 500 characters' }],
      [500, { error: 'rate limit reached, try again in a few minutes' }],
      [503, { error: 'questions are limited to 500 characters' }],
      [400, { error: { message: 'questions are limited to 500 characters' } }],
      [429, '<html>SECRET stack trace</html>'],
      [400, 'not json'],
    ];
    for (const [status, body] of cases) {
      const server = Bun.serve({
        port: 0,
        fetch: () => (typeof body === 'string' ? new Response(body, { status }) : Response.json(body, { status })),
      });
      servers.push(server);
      const chat = createAskChat({ api: new URL('/api/ask', server.url).href });
      expect((await ask(chat, 'hello')).error).toBe('the assistant is unavailable');
    }
  });

  test('normalizes text-only history before capping, dropping empty tool-only turns and all metadata', () => {
    const messages = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: `q${i}` }],
    }));
    const result = plainTextHistory([
      ...messages,
      { id: 'tool-only', role: 'assistant', parts: [{ type: 'step-start' }] },
      {
        id: 'text',
        role: 'assistant',
        metadata: { secret: 'not sent' },
        parts: [
          { type: 'step-start' },
          { type: 'text', text: 'A', providerMetadata: { openai: { itemId: 'SECRET' } } },
          { type: 'text', text: 'B' },
        ],
      },
    ]);
    expect(result.length).toBe(20);
    expect(result[0]?.id).toBe('6');
    expect(result.at(-1)).toEqual({ id: 'text', role: 'assistant', parts: [{ type: 'text', text: 'AB' }] });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(JSON.stringify(result)).not.toContain('tool-only');
  });

  test('never displays arbitrary server/provider details on errors', async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ error: 'SECRET <img src=x>' }, { status: 500 }) });
    servers.push(server);
    const chat = createAskChat({ api: new URL('/api/ask', server.url).href });
    expect((await ask(chat, 'hello')).error).toBe('the assistant is unavailable');
  });

  test('raw streamed provider errors stay generic even when their text matches a safe HTTP error', async () => {
    for (const errorText of ['SECRET provider stack <img src=x>', 'rate limit reached, try again in a few minutes']) {
      const server = Bun.serve({
        port: 0,
        fetch: () =>
          new Response(`data: ${JSON.stringify({ type: 'error', errorText })}\n\ndata: [DONE]\n\n`, {
            headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
          }),
      });
      servers.push(server);
      const chat = createAskChat({ api: new URL('/api/ask', server.url).href });
      expect((await ask(chat, 'hello')).error).toBe('the assistant is unavailable');
    }
  });
});
