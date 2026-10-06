import { describe, expect, test } from 'bun:test';
import { simulateReadableStream, type UIMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { AskController } from './ask.controller';
import { createRateLimiter } from './rate-limit';

const ANSWER = ['Begench ', 'builds ', 'web apps.'];

function mockModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start' as const, warnings: [] },
          { type: 'text-start' as const, id: 't1' },
          ...ANSWER.map((delta) => ({ type: 'text-delta' as const, id: 't1', delta })),
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
}

function controller({ model = mockModel(), limit = 10 }: { model?: MockLanguageModelV4 | null; limit?: number } = {}) {
  return new AskController({
    model,
    rateLimiter: createRateLimiter({ limit, windowMs: 60_000 }),
    loadCvText: async () => 'Fullstack Developer at Synecta, Tomsk.',
  });
}

function message(role: 'user' | 'assistant', text: string): UIMessage {
  return { id: crypto.randomUUID(), role, parts: [{ type: 'text', text }] };
}

function post(body: unknown): Request {
  return new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function streamedText(res: Response): Promise<string> {
  return (await res.text())
    .split('\n')
    .filter((line) => line.startsWith('data: {'))
    .map((line) => JSON.parse(line.slice('data: '.length)))
    .filter((event) => event.type === 'text-delta')
    .map((event) => event.delta)
    .join('');
}

describe('AskController', () => {
  test('streams the model answer as a UI message stream', async () => {
    const res = await controller().handle(post({ messages: [message('user', 'What does Begench do?')] }), '1.1.1.1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(await streamedText(res)).toBe('Begench builds web apps.');
  });

  test('grounds the model in the CV and passes earlier turns', async () => {
    const model = mockModel();
    const history: UIMessage[] = [
      message('user', 'Where does Begench work?'),
      { id: 'a1', role: 'assistant', parts: [{ type: 'step-start' }, { type: 'text', text: 'At Synecta.' }] },
      message('user', 'Since when?'),
    ];
    const res = await controller({ model }).handle(post({ messages: history }), '1.1.1.1');
    await res.text();
    const prompt = model.doStreamCalls[0].prompt;
    expect(prompt.map((entry) => entry.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(prompt[0].content).toContain('Fullstack Developer at Synecta, Tomsk.');
  });

  test('rejects malformed requests with a reason', async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => message(i % 2 ? 'assistant' : 'user', 'hi'));
    const cases: unknown[] = [
      'not json',
      { messages: tooMany },
      { messages: [message('user', 'x'.repeat(501))] },
      { messages: [{ id: 'f', role: 'user', parts: [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AA==' }] }] },
      { messages: [message('user', 'hi'), message('assistant', 'hello')] },
      { messages: [message('user', 'x'.repeat(40_000))] },
    ];
    for (const body of cases) {
      const res = await controller().handle(post(body), '1.1.1.1');
      expect(res.status).toBe(400);
      expect(typeof ((await res.json()) as { error?: unknown }).error).toBe('string');
    }
  });

  test('rate limits per client IP', async () => {
    const limited = controller({ limit: 1 });
    const body = { messages: [message('user', 'hi')] };
    await (await limited.handle(post(body), '1.1.1.1')).text();
    const blocked = await limited.handle(post(body), '1.1.1.1');
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'rate limit reached, try again in a few minutes' });
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    const other = await limited.handle(post(body), '2.2.2.2');
    expect(other.status).toBe(200);
    await other.text();
  });

  test('reports the assistant offline without a model', async () => {
    const res = await controller({ model: null }).handle(post({ messages: [message('user', 'hi')] }), '1.1.1.1');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'assistant is offline' });
  });

  test('hides provider errors behind a generic message', async () => {
    const failing = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start' as const, warnings: [] },
            { type: 'error' as const, error: new Error('provider exploded: internal detail') },
          ],
        }),
      }),
    });
    const res = await controller({ model: failing }).handle(post({ messages: [message('user', 'hi')] }), '1.1.1.1');
    const body = await res.text();
    expect(body).toContain('"errorText":"The assistant hit an error. Try again later."');
    expect(body).not.toContain('provider exploded');
  });
});
