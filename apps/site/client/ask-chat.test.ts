import { afterAll, describe, expect, spyOn, test } from 'bun:test';
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

const streamHeaders = { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' };
function answerStream(text: string) {
  return `${[
    { type: 'start', messageId: crypto.randomUUID() },
    { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: text },
    { type: 'text-end', id: 'text' },
    { type: 'finish', finishReason: 'stop' },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join('')}data: [DONE]\n\n`;
}

describe('createAskChat', () => {
  test.each([
    'empty',
    'whitespace',
    'malformed',
    'unfinished',
  ])('%s completion is unavailable, rolls back only the failed turn and releases the lock', async (failure) => {
    const requests: { messages: { role: string; parts: { text: string }[] }[] }[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        requests.push(await req.json());
        if (requests.length !== 2) return new Response(answerStream('Completed.'), { headers: streamHeaders });
        if (failure === 'unfinished')
          return new Response(answerStream('PRIVATE partial').replace(/data: \{"type":"finish"[^\n]+\n\n/, ''), { headers: streamHeaders });
        return new Response(
          failure === 'malformed' ? 'data: {PRIVATE invalid json}\n\n' : answerStream(failure === 'empty' ? '' : ' \n '),
          { headers: streamHeaders },
        );
      },
    });
    servers.push(server);
    const chat = createAskChat({ api: new URL('/api/ask', server.url).href });
    expect(await chat.ask('Keep this successful turn')).toEqual({ ok: true, text: 'Completed.' });
    expect(await chat.ask('Discard this failed turn')).toEqual({ ok: false, reason: 'unavailable' });
    expect(chat.busy()).toBe(false);
    expect(await chat.ask('Retry')).toEqual({ ok: true, text: 'Completed.' });
    expect(requests[2].messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(requests[2].messages.map((message) => message.parts[0].text)).toEqual(['Keep this successful turn', 'Completed.', 'Retry']);
  });

  test('rejected transport is unavailable, releases the lock and preserves successful history', async () => {
    const chat = chatAgainstServer(10);
    expect(await chat.ask('Keep this turn')).toEqual({ ok: true, text: 'Begench builds web apps.' });
    // Reject at the network boundary, not in Bun.serve's response writer (which
    // Bun correctly reports as an unhandled fixture error).
    const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('PRIVATE fetch failure'));
    try {
      expect(await chat.ask('Discard this turn')).toEqual({ ok: false, reason: 'unavailable' });
      expect(chat.busy()).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
    expect(await chat.ask('Retry')).toEqual({ ok: true, text: 'Begench builds web apps.' });
    expect(model.doStreamCalls.at(-1)?.prompt.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(JSON.stringify(model.doStreamCalls.at(-1)?.prompt)).not.toContain('Discard this turn');
  });

  test('concurrent calls return busy without settling, sending or changing the active turn history', async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const received = new Promise<void>((resolve) => {
      started = resolve;
    });
    const requests: { messages: { parts: { text: string }[] }[] }[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        requests.push(await req.json());
        started();
        if (requests.length === 1) await gate;
        return new Response(answerStream('Active answer.'), { headers: streamHeaders });
      },
    });
    servers.push(server);
    const chat = createAskChat({ api: new URL('/api/ask', server.url).href });
    const active = chat.ask('Active question');
    expect(chat.busy()).toBe(true);
    await received;
    expect(await chat.ask('Do not send')).toEqual({ ok: false, reason: 'busy' });
    expect(chat.busy()).toBe(true);
    expect(requests).toHaveLength(1);
    release();
    expect(await active).toEqual({ ok: true, text: 'Active answer.' });
    expect(chat.busy()).toBe(false);
    await chat.ask('Follow-up');
    expect(requests[1].messages.map((message) => message.parts[0].text)).toEqual(['Active question', 'Active answer.', 'Follow-up']);
  });

  test('returns one completed answer and sends earlier turns with the next question', async () => {
    const chat = chatAgainstServer(10);
    expect(await chat.ask('What does Begench do?')).toEqual({ ok: true, text: 'Begench builds web apps.' });
    expect(chat.busy()).toBe(false);
    await chat.ask('Since when?');
    expect(model.doStreamCalls.at(-1)?.prompt.map((entry) => entry.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(model.doStreamCalls.at(-1)?.prompt[2]?.content).toEqual([{ type: 'text', text: 'Begench builds web apps.' }]);
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
    expect(await chat.ask('first')).toEqual({ ok: false, reason: 'unavailable' });
    expect(chat.busy()).toBe(false);
    expect(await chat.ask('second')).toEqual({ ok: true, text: 'Recovered.' });
    expect(flaky.doStreamCalls[1].prompt.map((entry) => entry.role)).toEqual(['system', 'user']);
  });

  test('reports the safe rate-limit message and is ready for the next question', async () => {
    const chat = chatAgainstServer(1);
    await chat.ask('first');
    expect(await chat.ask('second')).toEqual({ ok: false, reason: 'rate-limit' });
    expect(chat.busy()).toBe(false);
  });

  test('reports the safe question-length validation message and rolls back the failed turn', async () => {
    const chat = chatAgainstServer(10);
    expect(await chat.ask('x'.repeat(501))).toEqual({ ok: false, reason: 'question-length' });
    expect(chat.busy()).toBe(false);
    expect(await chat.ask('A valid question')).toEqual({ ok: true, text: 'Begench builds web apps.' });
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
      expect(await chat.ask('hello')).toEqual({ ok: false, reason: 'unavailable' });
      expect(chat.busy()).toBe(false);
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
    expect(await chat.ask('hello')).toEqual({ ok: false, reason: 'unavailable' });
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
      expect(await chat.ask('hello')).toEqual({ ok: false, reason: 'unavailable' });
    }
  });
});
