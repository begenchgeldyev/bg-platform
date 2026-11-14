import { AbstractChat, APICallError, type ChatState, type ChatStatus, DefaultChatTransport, type UIMessage } from 'ai';

const MAX_HISTORY = 20;

export function plainTextHistory(messages: UIMessage[]): UIMessage[] {
  return messages
    .flatMap(({ id, role, parts }) => {
      if (role !== 'user' && role !== 'assistant') return [];
      const text = parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');
      return text.trim() ? [{ id, role, parts: [{ type: 'text' as const, text }] }] : [];
    })
    .slice(-MAX_HISTORY);
}

export type AskResult = { ok: true; text: string } | { ok: false; reason: 'unavailable' | 'rate-limit' | 'question-length' | 'busy' };

export type AskChat = {
  busy: () => boolean;
  ask: (question: string) => Promise<AskResult>;
};

class TerminalChatState implements ChatState<UIMessage> {
  status: ChatStatus = 'ready';
  error: Error | undefined = undefined;
  messages: UIMessage[] = [];

  pushMessage = (message: UIMessage) => {
    this.messages = [...this.messages, message];
  };

  popMessage = () => {
    this.messages = this.messages.slice(0, -1);
  };

  replaceMessage = (index: number, message: UIMessage) => {
    this.messages = this.messages.map((current, i) => (i === index ? message : current));
  };

  snapshot = <T>(thing: T): T => structuredClone(thing);
}

class TerminalChat extends AbstractChat<UIMessage> {
  constructor(api: string, onComplete: (text: string) => void) {
    super({
      state: new TerminalChatState(),
      transport: new DefaultChatTransport({
        api,
        prepareSendMessagesRequest: ({ id, messages }) => ({ body: { id, messages: plainTextHistory(messages) } }),
      }),
      onFinish: ({ message, isAbort, isDisconnect, isError, finishReason }) => {
        // A closed connection alone is not a completed answer. Keep partial and
        // interrupted streams private, even if the SDK returns to ready status.
        if (!isAbort && !isDisconnect && !isError && finishReason && finishReason !== 'error' && message.role === 'assistant') {
          onComplete(textOf(message));
        }
      },
    });
  }
}

function textOf(message: UIMessage | undefined): string {
  return (message?.parts ?? []).map((part) => (part.type === 'text' ? part.text : '')).join('');
}

function safeErrorReason(error: unknown): Extract<AskResult, { ok: false }>['reason'] {
  if (!APICallError.isInstance(error)) return 'unavailable';
  const safeMessage =
    error.statusCode === 429
      ? 'rate limit reached, try again in a few minutes'
      : error.statusCode === 400
        ? 'questions are limited to 500 characters'
        : null;
  if (!safeMessage) return 'unavailable';
  try {
    const body = JSON.parse(error.responseBody ?? '');
    // Classify only exact, known status/message pairs. Never
    // relay arbitrary server JSON, provider details or error.message to visitors.
    return body?.error === safeMessage ? (error.statusCode === 429 ? 'rate-limit' : 'question-length') : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export function createAskChat({ api }: { api: string }): AskChat {
  let pending = false;
  const completion: { text: string | null } = { text: null };
  const chat = new TerminalChat(api, (text) => {
    completion.text = text;
  });

  return {
    busy: () => pending,
    async ask(question) {
      if (pending) return { ok: false, reason: 'busy' };
      pending = true; // Reserve synchronously, before the SDK's first await.
      const before = chat.messages.slice();
      let succeeded = false;
      completion.text = null;
      try {
        await chat.sendMessage({ text: question });
        if (chat.status === 'error') return { ok: false, reason: safeErrorReason(chat.error) };
        const text = completion.text;
        if (!text?.trim()) return { ok: false, reason: 'unavailable' };
        succeeded = true;
        return { ok: true, text };
      } catch (error) {
        return { ok: false, reason: safeErrorReason(error) };
      } finally {
        if (!succeeded) chat.messages = before;
        chat.clearError();
        completion.text = null;
        pending = false;
      }
    },
  };
}
