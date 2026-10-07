import { type AskChat, createAskChat } from './ask-chat';

(globalThis as typeof globalThis & { askChat?: AskChat }).askChat = createAskChat({ api: '/api/ask' });
