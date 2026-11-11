import { AbstractChat, APICallError, type ChatState, type ChatStatus, DefaultChatTransport, type UIMessage } from 'ai';

const MAX_HISTORY = 20;
const UNAVAILABLE = 'the assistant is unavailable';

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

export type AskHandlers = {
  onText: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

export type AskChat = {
  busy: () => boolean;
  ask: (question: string, handlers: AskHandlers) => Promise<void>;
};

class TerminalChatState implements ChatState<UIMessage> {
  status: ChatStatus = 'ready';
  error: Error | undefined = undefined;
  messages: UIMessage[] = [];

  constructor(private readonly onChange: () => void) {}

  pushMessage = (message: UIMessage) => {
    this.messages = [...this.messages, message];
    this.onChange();
  };

  popMessage = () => {
    this.messages = this.messages.slice(0, -1);
    this.onChange();
  };

  replaceMessage = (index: number, message: UIMessage) => {
    this.messages = this.messages.map((current, i) => (i === index ? message : current));
    this.onChange();
  };

  snapshot = <T>(thing: T): T => structuredClone(thing);
}

class TerminalChat extends AbstractChat<UIMessage> {
  constructor(api: string, onChange: () => void) {
    super({
      state: new TerminalChatState(onChange),
      transport: new DefaultChatTransport({
        api,
        prepareSendMessagesRequest: ({ id, messages }) => ({ body: { id, messages: plainTextHistory(messages) } }),
      }),
    });
  }
}

function textOf(message: UIMessage | undefined): string {
  return (message?.parts ?? []).map((part) => (part.type === 'text' ? part.text : '')).join('');
}

function safeErrorMessage(error: Error | undefined): string {
  if (!APICallError.isInstance(error)) return UNAVAILABLE;
  const safeMessage =
    error.statusCode === 429
      ? 'rate limit reached, try again in a few minutes'
      : error.statusCode === 400
        ? 'questions are limited to 500 characters'
        : null;
  if (!safeMessage) return UNAVAILABLE;
  try {
    const body = JSON.parse(error.responseBody ?? '');
    // Return local static text only for exact, known status/message pairs. Never
    // relay arbitrary server JSON, provider details or error.message to visitors.
    return body?.error === safeMessage ? safeMessage : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

export function createAskChat({ api }: { api: string }): AskChat {
  let handlers: AskHandlers | null = null;
  const chat = new TerminalChat(api, () => {
    const last = chat.lastMessage;
    if (last?.role === 'assistant') {
      handlers?.onText(textOf(last));
    }
  });

  return {
    busy: () => chat.status === 'submitted' || chat.status === 'streaming',
    async ask(question, next) {
      const before = chat.messages.length;
      handlers = next;
      await chat.sendMessage({ text: question });
      handlers = null;
      if (chat.status !== 'error') {
        next.onDone();
        return;
      }
      const message = safeErrorMessage(chat.error);
      chat.messages = chat.messages.slice(0, before);
      chat.clearError();
      next.onError(message);
    },
  };
}
