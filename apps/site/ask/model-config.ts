import { createOpenAI, type OpenAIProviderSettings } from '@ai-sdk/openai';

const DEFAULT_MODEL = 'gpt-6.1-sol-fast';

type ModelEnv = {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
};

// Server-only configuration; never import this module from the browser bundle.
export function createAskModel(
  env: ModelEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
  },
  fetch?: OpenAIProviderSettings['fetch'],
) {
  if (!env.OPENAI_API_KEY?.trim()) return null;
  const provider = createOpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL || undefined,
    fetch,
  });
  return provider.responses(env.OPENAI_MODEL || DEFAULT_MODEL);
}
