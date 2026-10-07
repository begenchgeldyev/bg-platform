import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  type LanguageModel,
  streamText,
  toUIMessageStream,
  type UIMessage,
  validateUIMessages,
} from 'ai';
import { buildInstructions } from './instructions';
import type { RateLimiter } from './rate-limit';

export const ASK_LIMITS = {
  maxBodyBytes: 32 * 1024,
  maxMessages: 20,
  maxQuestionChars: 500,
  maxOutputTokens: 500,
} as const;

type AskControllerDeps = {
  model: LanguageModel | null;
  rateLimiter: RateLimiter;
  loadCvText: () => Promise<string>;
};

function errorResponse(status: number, error: string, headers?: Record<string, string>) {
  return Response.json({ error }, { status, headers });
}

async function readBodyWithin(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) {
    return '';
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Bun.concatArrayBuffers(chunks));
}

function messageText(message: UIMessage) {
  return message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

// Clients echo earlier answers back with provider metadata (OpenAI item ids). Forwarding it makes the provider
// reference stored items instead of resending the text, which fails when the endpoint does not store responses.
function toPlainTextMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map(({ id, role, parts }) => ({
    id,
    role,
    parts: parts.flatMap((part) => (part.type === 'text' ? [{ type: 'text' as const, text: part.text }] : [])),
  }));
}

function findLimitViolation(messages: UIMessage[]): string | null {
  if (messages.length > ASK_LIMITS.maxMessages) {
    return `send at most ${ASK_LIMITS.maxMessages} messages`;
  }
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') {
      return 'only user and assistant messages are allowed';
    }
    if (message.parts.some((part) => part.type !== 'text' && part.type !== 'step-start')) {
      return 'only text messages are allowed';
    }
    if (message.role === 'user' && messageText(message).length > ASK_LIMITS.maxQuestionChars) {
      return `questions are limited to ${ASK_LIMITS.maxQuestionChars} characters`;
    }
  }
  if (messages.at(-1)?.role !== 'user') {
    return 'the last message must be a question';
  }
  return null;
}

export class AskController {
  constructor(private readonly deps: AskControllerDeps) {}

  async handle(req: Request, clientIp: string): Promise<Response> {
    const { model, rateLimiter, loadCvText } = this.deps;
    if (!model) {
      return errorResponse(503, 'assistant is offline');
    }

    const slot = rateLimiter.take(clientIp);
    if (!slot.ok) {
      return errorResponse(429, 'rate limit reached, try again in a few minutes', {
        'Retry-After': String(Math.ceil(slot.retryAfterMs / 1000)),
      });
    }

    if (Number(req.headers.get('content-length') ?? 0) > ASK_LIMITS.maxBodyBytes) {
      return errorResponse(400, 'request is too large');
    }
    const raw = await readBodyWithin(req, ASK_LIMITS.maxBodyBytes);
    if (raw === null) {
      return errorResponse(400, 'request is too large');
    }

    let messages: UIMessage[];
    try {
      const body: { messages?: unknown } = JSON.parse(raw);
      messages = await validateUIMessages({ messages: body.messages });
    } catch {
      return errorResponse(400, 'invalid request');
    }

    const violation = findLimitViolation(messages);
    if (violation) {
      return errorResponse(400, violation);
    }

    const result = streamText({
      model,
      instructions: buildInstructions(await loadCvText()),
      messages: await convertToModelMessages(toPlainTextMessages(messages)),
      maxOutputTokens: ASK_LIMITS.maxOutputTokens,
      abortSignal: req.signal,
      onError: ({ error }) => console.error('ask: generation failed', error),
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        sendReasoning: false,
        onError: () => 'The assistant hit an error. Try again later.',
      }),
    });
  }
}
