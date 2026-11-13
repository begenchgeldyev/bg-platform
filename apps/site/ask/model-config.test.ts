import { describe, expect, test } from 'bun:test';
import type { OpenAIProviderSettings } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { createAskModel } from './model-config';

describe('website model configuration', () => {
  test('stays offline without a nonblank server API key', () => {
    for (const env of [{}, { OPENAI_API_KEY: '' }, { OPENAI_API_KEY: '  ', OPENAI_BASE_URL: 'http://proxy.invalid/v1' }]) {
      expect(createAskModel(env)).toBeNull();
    }
  });

  for (const override of [undefined, 'custom-model']) {
    test(`uses configured proxy Responses endpoint and ${override ? 'explicit model override' : 'Sol Fast default'}`, async () => {
      const calls: { url: string; model: unknown; authorization: string | null }[] = [];
      const mockFetch: OpenAIProviderSettings['fetch'] = Object.assign(
        async (...[input, init]: Parameters<typeof fetch>) => {
          const body = JSON.parse(String(init?.body));
          calls.push({ url: String(input), model: body.model, authorization: new Headers(init?.headers).get('authorization') });
          return Response.json({
            id: 'resp_test',
            object: 'response',
            created_at: 0,
            status: 'completed',
            model: body.model,
            output: [
              {
                id: 'msg_test',
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'Mock answer.', annotations: [] }],
              },
            ],
            usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
          });
        },
        { preconnect() {} },
      );
      const model = createAskModel(
        {
          OPENAI_API_KEY: 'test-placeholder-key',
          OPENAI_BASE_URL: 'http://proxy.invalid/v1/',
          OPENAI_MODEL: override,
        },
        mockFetch,
      );
      if (!model) throw new Error('Expected configured server model');
      expect(model.modelId).toBe(override ?? 'gpt-6.1-sol-fast');
      const result = await generateText({ model, prompt: 'Mock-only check', maxRetries: 0, maxOutputTokens: 10 });
      expect(result.text).toBe('Mock answer.');
      expect(calls).toEqual([
        {
          url: 'http://proxy.invalid/v1/responses',
          model: override ?? 'gpt-6.1-sol-fast',
          authorization: 'Bearer test-placeholder-key',
        },
      ]);
      expect(calls.some((call) => new URL(call.url).hostname === 'api.openai.com')).toBe(false);
    });
  }
});
