import { AbstractChat, APICallError, type ChatState, type ChatStatus, DefaultChatTransport, type UIMessage } from 'ai';

const MAX_HISTORY = 20;
const UNAVAILABLE = 'the assistant is unavailable';

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
        prepareSendMessagesRequest: ({ id, messages }) => ({ body: { id, messages: messages.slice(-MAX_HISTORY) } }),
      }),
    });
  }
}

function textOf(message: UIMessage | undefined): string {
  return (message?.parts ?? []).map((part) => (part.type === 'text' ? part.text : '')).join('');
}

function serverError(responseBody: string | undefined): string | null {
  try {
    const body = JSON.parse(responseBody ?? '');
    return typeof body?.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

function errorMessage(error: Error | undefined): string {
  if (APICallError.isInstance(error)) {
    return serverError(error.responseBody) ?? UNAVAILABLE;
  }
  return error?.message || UNAVAILABLE;
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
      const message = errorMessage(chat.error);
      chat.messages = chat.messages.slice(0, before);
      chat.clearError();
      next.onError(message);
    },
  };
}
