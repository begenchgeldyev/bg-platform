import { afterAll, describe, expect, test } from 'bun:test';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { AskController } from '../ask/ask.controller';
import { createRateLimiter } from '../ask/rate-limit';
import { type AskChat, createAskChat } from './ask-chat';

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
    expect(failed.error).toBe('The assistant hit an error. Try again later.');
    const retried = await ask(chat, 'second');
    expect(retried.texts.at(-1)).toBe('Recovered.');
    expect(flaky.doStreamCalls[1].prompt.map((entry) => entry.role)).toEqual(['system', 'user']);
  });

  test('reports the server error message and is ready for the next question', async () => {
    const chat = chatAgainstServer(1);
    await ask(chat, 'first');
    const failed = await ask(chat, 'second');
    expect(failed.error).toBe('rate limit reached, try again in a few minutes');
    expect(chat.busy()).toBe(false);
  });
});
