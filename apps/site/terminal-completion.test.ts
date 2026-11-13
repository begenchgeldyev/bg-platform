import { describe, expect, test } from 'bun:test';
import type { AskChat, AskHandlers } from './client/ask-chat';

/**
 * Executes the real inline terminal script from terminal-emulator.html against a
 * deliberately small DOM stub. Assertions therefore target behaviour of the shipped
 * code (input value, visible display, caret, key default), not source strings.
 */

class StubElement {
  children: StubElement[] = [];
  innerHTML = '';
  className = '';
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 400;
  value = '';
  readOnly = false;
  hidden = false;
  placeholder = '';
  attributes = new Map<string, string>();
  selectionStart = 0;
  selectionEnd = 0;
  private text = '';
  handlers: Record<string, Array<(event: StubEvent) => void>> = {};
  queries = new Map<string, StubElement>();

  constructor(public id: string) {}

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  getBoundingClientRect() {
    return { top: 0 };
  }
  append(...nodes: StubElement[]) {
    this.children.push(...nodes);
  }

  addEventListener(type: string, handler: (event: StubEvent) => void) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(handler);
  }

  insertBefore(node: StubElement, reference: StubElement | null) {
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index === -1) this.children.push(node);
    else this.children.splice(index, 0, node);
    return node;
  }

  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  focus() {}
  remove() {}
  replaceChildren(...nodes: StubElement[]) {
    this.children = nodes;
  }
  scrollIntoView() {}
  querySelector(selector: string) {
    const element = this.queries.get(selector) ?? new StubElement(selector);
    this.queries.set(selector, element);
    return element;
  }

  get textContent() {
    return this.text;
  }

  set textContent(value: string) {
    this.text = String(value);
  }

  dispatch(type: string, event: StubEvent) {
    for (const handler of this.handlers[type] ?? []) handler(event);
  }
}

type StubEvent = {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  defaultPrevented?: boolean;
  preventDefault: () => void;
};

const html = await Bun.file(new URL('./components/terminal-emulator.html', import.meta.url)).text();
const inlineScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((source) => source.includes('const COMMANDS'));

if (!inlineScript) throw new Error('terminal emulator inline script not found');
const terminalScript = inlineScript;

function createTerminal(assistant?: AskChat) {
  const elements = new Map<string, StubElement>();
  for (const id of [
    'terminal-wrap',
    'terminal-body',
    'input-line',
    'terminal-input',
    'terminal-prompt',
    'terminal-loader',
    'terminal-status',
  ]) {
    elements.set(id, new StubElement(id));
  }

  const body = elements.get('terminal-body') as StubElement;
  const inputLine = elements.get('input-line') as StubElement;
  const input = elements.get('terminal-input') as StubElement;
  body.children.push(inputLine);

  const documentStub = {
    documentElement: { lang: 'en' },
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string) => new StubElement(tag),
  };
  const navigations: string[] = [];
  const opened: string[] = [];
  const windowStub = {
    getSelection: () => null,
    askChat: assistant,
    location: {
      set href(value: string) {
        navigations.push(value);
      },
    },
    open: (url: string) => opened.push(url),
  };

  const run = new Function('document', 'window', 'performance', terminalScript);
  run(documentStub, windowStub, performance);

  const appended = () =>
    body.children
      .filter((child) => child !== inputLine)
      .map((child) => child.innerHTML)
      .join('\n');

  return {
    input,
    status: elements.get('terminal-status') as StubElement,
    prompt: elements.get('terminal-prompt') as StubElement,
    loader: elements.get('terminal-loader') as StubElement,
    answers: () => body.children.flatMap((line) => line.children).filter((child) => child.attributes.has('data-answer')),
    appended,
    body,
    navigations,
    opened,
    press(key: string, options: Partial<StubEvent> = {}) {
      input.dispatch('keydown', { key, preventDefault() {}, ...options });
    },
    setLine(value: string, caret = value.length) {
      input.value = value;
      input.setSelectionRange(caret, caret);
    },
    pressTab({ shift = false }: { shift?: boolean } = {}) {
      let prevented = false;
      const event: StubEvent = {
        key: 'Tab',
        shiftKey: shift,
        ctrlKey: false,
        preventDefault() {
          prevented = true;
        },
      };
      input.dispatch('keydown', event);
      return prevented;
    },
  };
}

describe('terminal Tab completion', () => {
  test('cat phi completes the visible line to cat philosophy.txt', () => {
    const terminal = createTerminal();
    terminal.setLine('cat phi');

    const prevented = terminal.pressTab();

    expect(prevented).toBe(true);
    expect(terminal.input.value).toBe('cat philosophy.txt');
    expect(terminal.input.selectionStart).toBe('cat philosophy.txt'.length);
    expect(terminal.input.selectionEnd).toBe('cat philosophy.txt'.length);
  });

  test('cat sk completes skills.txt', () => {
    const terminal = createTerminal();
    terminal.setLine('cat sk');

    terminal.pressTab();

    expect(terminal.input.value).toBe('cat skills.txt');
  });

  test('cat co completes contact.txt', () => {
    const terminal = createTerminal();
    terminal.setLine('cat co');

    terminal.pressTab();

    expect(terminal.input.value).toBe('cat contact.txt');
  });

  test('open gi completes github and open li completes linkedin', () => {
    const github = createTerminal();
    github.setLine('open gi');
    github.pressTab();
    expect(github.input.value).toBe('open github');

    const linkedin = createTerminal();
    linkedin.setLine('open li');
    linkedin.pressTab();
    expect(linkedin.input.value).toBe('open linkedin');
  });

  test('open gh has no known match and is left untouched', () => {
    const terminal = createTerminal();
    terminal.setLine('open gh');

    const prevented = terminal.pressTab();

    expect(prevented).toBe(true);
    expect(terminal.input.value).toBe('open gh');
    expect(terminal.appended()).toBe('');
  });

  test('open cv is an exact existing token and stays unchanged', () => {
    const terminal = createTerminal();
    terminal.setLine('open cv');

    terminal.pressTab();

    expect(terminal.input.value).toBe('open cv');
    expect(terminal.appended()).toBe('');
  });

  test('command prefix completes against the existing command table', () => {
    const terminal = createTerminal();
    terminal.setLine('pro');

    terminal.pressTab();

    expect(terminal.input.value).toBe('projects');
  });

  test('command prefix keeps following arguments and whitespace', () => {
    const terminal = createTerminal();
    terminal.setLine('who  me', 3);

    terminal.pressTab();

    expect(terminal.input.value).toBe('whoami  me');
  });

  test('empty cat argument lists files without mutating the line', () => {
    const terminal = createTerminal();
    terminal.setLine('cat ');

    terminal.pressTab();

    expect(terminal.input.value).toBe('cat ');
    const listed = terminal.appended();
    expect(listed).toContain('philosophy.txt');
    expect(listed).toContain('skills.txt');
    expect(listed).toContain('contact.txt');
  });

  test('ambiguous command prefix lists candidates instead of choosing one', () => {
    const terminal = createTerminal();
    terminal.setLine('c');

    terminal.pressTab();

    expect(terminal.input.value).toBe('c');
    const listed = terminal.appended();
    expect(listed).toContain('cat');
    expect(listed).toContain('clear');
  });

  test('no-match argument is unchanged with no output', () => {
    const terminal = createTerminal();
    terminal.setLine('cat zzz');

    terminal.pressTab();

    expect(terminal.input.value).toBe('cat zzz');
    expect(terminal.appended()).toBe('');
  });

  test('middle-caret argument completion preserves suffix and caret', () => {
    const terminal = createTerminal();
    terminal.setLine('cat phi extra', 'cat phi'.length);

    terminal.pressTab();

    expect(terminal.input.value).toBe('cat philosophy.txt extra');
    expect(terminal.input.selectionStart).toBe('cat philosophy.txt'.length);
    expect(terminal.input.selectionEnd).toBe('cat philosophy.txt'.length);
  });

  test('middle-caret command completion preserves the rest of the line', () => {
    const terminal = createTerminal();
    terminal.setLine('pro later args', 3);

    terminal.pressTab();

    expect(terminal.input.value).toBe('projects later args');
    expect(terminal.input.selectionStart).toBe('projects'.length);
  });

  test('double spaces between command and argument are preserved', () => {
    const terminal = createTerminal();
    terminal.setLine('cat  phi');

    terminal.pressTab();

    expect(terminal.input.value).toBe('cat  philosophy.txt');
  });

  test('caret in a later token refuses to rewrite the line', () => {
    const terminal = createTerminal();
    terminal.setLine('cat phi extra', 'cat phi extra'.length);

    terminal.pressTab();

    expect(terminal.input.value).toBe('cat phi extra');
  });

  test('Shift+Tab is not captured and keeps native focus traversal', () => {
    const terminal = createTerminal();
    terminal.setLine('cat phi');

    const prevented = terminal.pressTab({ shift: true });

    expect(prevented).toBe(false);
    expect(terminal.input.value).toBe('cat phi');
    expect(terminal.appended()).toBe('');
  });
});

describe('direct terminal AI', () => {
  test('locks synchronously before a repeated Enter can echo or send another pending turn', () => {
    let calls = 0;
    const terminal = createTerminal({
      busy: () => false,
      ask: () => {
        calls++;
        return new Promise(() => {});
      },
    });
    terminal.setLine('A question');
    terminal.press('Enter');
    const transcript = terminal.appended();
    terminal.press('Enter');
    expect(calls).toBe(1);
    expect(terminal.appended()).toBe(transcript);
    expect(terminal.input.readOnly).toBe(true);
  });
  test('hello is a direct message and ask-prefixed prose is forwarded in full', () => {
    const questions: string[] = [];
    const terminal = createTerminal({
      busy: () => false,
      ask: async (question, handlers) => {
        questions.push(question);
        handlers.onText('Answer');
        handlers.onDone();
      },
    });
    for (const line of ['hello', 'ask', 'ask  Where do you work?']) {
      terminal.setLine(line);
      terminal.press('Enter');
    }
    expect(questions).toEqual(['hello', 'ask', 'ask  Where do you work?']);
  });

  test('help and command completions never advertise or complete ask', () => {
    const terminal = createTerminal();
    terminal.setLine('as');
    terminal.pressTab();
    expect(terminal.input.value).toBe('as');
    expect(terminal.appended()).toBe('');
    terminal.setLine('help');
    terminal.press('Enter');
    expect(terminal.appended()).not.toContain('ask');
    expect(terminal.appended()).toContain('cat [file]');
    const commands = createTerminal();
    commands.setLine('');
    commands.pressTab();
    expect(commands.appended()).not.toContain('ask');
    expect(commands.appended()).toContain('whoami');
  });

  test('offline, busy and stream failures have no ask prefix and include safe retry guidance', () => {
    const offline = createTerminal();
    offline.setLine('hello');
    offline.press('Enter');
    expect(offline.appended()).not.toContain('ask:');
    expect(offline.appended()).toContain('try again');
    const busy = createTerminal({ busy: () => true, ask: async () => {} });
    busy.setLine('hello');
    busy.press('Enter');
    expect(busy.appended()).not.toContain('ask:');
    expect(busy.appended()).toBe('');
    expect(busy.status.textContent).toBe('Preparing a reply…');
    expect(busy.input.value).toBe('hello');
    for (const message of [
      'SECRET provider stack <img src=x>',
      'rate limit reached, try again in a few minutes',
      'questions are limited to 500 characters',
    ]) {
      const terminal = createTerminal({
        busy: () => false,
        ask: async (_question, handlers) => {
          handlers.onError(message);
        },
      });
      terminal.setLine('hello');
      terminal.press('Enter');
      const error = terminal.body.children.flatMap((line) => line.children).find((child) => child.className === 'text-error/80');
      expect(error?.textContent).not.toContain('ask:');
      expect(error?.textContent).not.toContain('SECRET');
      expect(error?.textContent).toContain('try again');
      if (message.startsWith('rate')) expect(error?.textContent).toContain('Rate limit reached');
      if (message.startsWith('questions')) expect(error?.textContent).toContain('500 characters');
    }
  });
  test('sends ordinary prose, even command-word sentences, to askChat without navigation', () => {
    const questions: string[] = [];
    const terminal = createTerminal({
      busy: () => false,
      ask: async (question, handlers) => {
        questions.push(question);
        handlers.onText('<img src=x onerror=alert(1)>');
        handlers.onDone();
      },
    });
    for (const question of ['What have you built?', 'projects you built?', 'logs from your career?', 'open your best project']) {
      terminal.setLine(question);
      terminal.press('Enter');
    }
    expect(questions).toEqual(['What have you built?', 'projects you built?', 'logs from your career?', 'open your best project']);
    expect(terminal.navigations).toEqual([]);
    expect(terminal.opened).toEqual([]);
    terminal.press('ArrowUp');
    expect(terminal.input.value).toBe('open your best project');
  });

  test('prose and streamed errors remain inert text, including entity-encoded markup', () => {
    const unsafe = '<img src=x onerror=alert(1)>&lt;script&gt;';
    const terminal = createTerminal({
      busy: () => false,
      ask: async (_question, handlers) => {
        handlers.onText(unsafe);
        handlers.onDone();
      },
    });
    terminal.setLine(`What is ${unsafe}?`);
    terminal.press('Enter');
    expect(terminal.appended()).not.toContain(unsafe);
    expect(terminal.appended()).toContain('&amp;lt;script&amp;gt;');
    expect(terminal.answers()[0]?.textContent).toBe(unsafe);
    expect(terminal.answers()[0]?.innerHTML).toBe('');
  });

  test('busy/offline assistant is safe and inherited command keys never execute', () => {
    let calls = 0;
    const terminal = createTerminal({
      busy: () => true,
      ask: async () => {
        calls++;
      },
    });
    terminal.setLine('constructor');
    terminal.press('Enter');
    expect(calls).toBe(0);
    expect(terminal.appended()).toBe('');
    expect(terminal.input.value).toBe('constructor');
    expect(terminal.status.textContent).toBe('Preparing a reply…');
    const offline = createTerminal();
    offline.setLine('a natural question');
    offline.press('Enter');
    expect(offline.appended()).toContain('unavailable');
  });

  test('explicit navigation and link commands still require literal manual input', async () => {
    const terminal = createTerminal();
    terminal.setLine('open github');
    terminal.press('Enter');
    expect(terminal.opened).toEqual(['https://github.com/begenchgeldyev']);
    terminal.setLine('projects');
    terminal.press('Enter');
    await Bun.sleep(320);
    expect(terminal.navigations).toEqual(['/projects']);
  });

  test('retains literal manual commands and treats ask as ordinary prose, safely escaping echo/errors', () => {
    const questions: string[] = [];
    const terminal = createTerminal({
      busy: () => false,
      ask: async (question, handlers) => {
        questions.push(question);
        handlers.onText('Answer');
        handlers.onDone();
      },
    });
    for (const line of ['whoami', 'cat philosophy.txt', 'ask Where do you work?', 'cat <img&x>']) {
      terminal.setLine(line);
      terminal.press('Enter');
    }
    expect(questions).toEqual(['ask Where do you work?']);
    expect(terminal.appended()).toContain('Performance is not a feature');
    expect(terminal.appended()).not.toContain('<img&x>');
    expect(terminal.appended()).toContain('&lt;img&amp;x&gt;');
  });
});

function pendingAssistant() {
  const calls: { question: string; handlers: AskHandlers }[] = [];
  const assistant: AskChat = {
    busy: () => false,
    ask(question, handlers) {
      calls.push({ question, handlers });
      return new Promise(() => {});
    },
  };
  return { calls, assistant };
}

describe('calm terminal turns', () => {
  test('blank and composing Enter do not echo, clear a draft or enter history', () => {
    const { calls, assistant } = pendingAssistant();
    const terminal = createTerminal(assistant);
    terminal.setLine('  ');
    terminal.press('Enter');
    expect(terminal.appended()).toBe('');
    expect(terminal.input.value).toBe('  ');
    terminal.setLine('a composing question');
    terminal.press('Enter', { isComposing: true });
    terminal.press('Enter', { keyCode: 229 });
    expect(terminal.input.value).toBe('a composing question');
    expect(calls).toHaveLength(0);
    terminal.press('ArrowUp');
    expect(terminal.input.value).toBe('');
  });

  test('buffers cumulative text until done and shows just one final inert answer', () => {
    const { calls, assistant } = pendingAssistant();
    const terminal = createTerminal(assistant);
    terminal.setLine('What do you build?');
    terminal.press('Enter');
    expect(terminal.prompt.hidden).toBe(true);
    expect(terminal.loader.hidden).toBe(false);
    expect(terminal.input.placeholder).toBe('Preparing a reply…');
    const top = terminal.body.scrollTop;
    calls[0].handlers.onText('Partial');
    calls[0].handlers.onText('A complete <b>literal</b> answer.');
    expect(terminal.answers()).toHaveLength(0);
    expect(terminal.body.scrollTop).toBe(top);
    calls[0].handlers.onDone();
    expect(terminal.answers()).toHaveLength(1);
    expect(terminal.answers()[0].textContent).toBe('A complete <b>literal</b> answer.');
    expect(terminal.answers()[0].innerHTML).toBe('');
    expect(terminal.prompt.hidden).toBe(false);
    expect(terminal.loader.hidden).toBe(true);
    expect(terminal.input.readOnly).toBe(false);
    expect(terminal.status.textContent).toBe('Reply ready.');
  });

  test('pending turn blocks submit/history/clear/completion but leaves both Tab directions native', () => {
    const { calls, assistant } = pendingAssistant();
    const terminal = createTerminal(assistant);
    terminal.setLine('Question');
    terminal.press('Enter');
    const transcript = terminal.appended();
    for (const key of ['Enter', 'ArrowUp', 'ArrowDown']) terminal.press(key);
    terminal.press('l', { ctrlKey: true });
    expect(terminal.pressTab()).toBe(false);
    expect(terminal.pressTab({ shift: true })).toBe(false);
    expect(terminal.input.value).toBe('');
    expect(terminal.appended()).toBe(transcript);
    expect(calls).toHaveLength(1);
    calls[0].handlers.onText('Answer');
    calls[0].handlers.onDone();
    terminal.press('ArrowUp');
    expect(terminal.input.value).toBe('Question');
    terminal.setLine('cat phi');
    expect(terminal.pressTab()).toBe(true);
    expect(terminal.input.value).toBe('cat philosophy.txt');
  });

  test('partial failure restores retry draft and stale callbacks cannot overwrite the next turn', () => {
    const { calls, assistant } = pendingAssistant();
    const terminal = createTerminal(assistant);
    terminal.setLine('Retry this');
    terminal.press('Enter');
    calls[0].handlers.onText('Do not show partial text');
    calls[0].handlers.onError('SECRET internal error');
    expect(terminal.input.value).toBe('Retry this');
    expect(terminal.input.readOnly).toBe(false);
    expect(terminal.answers()).toHaveLength(0);
    expect(terminal.status.textContent).toBe('The assistant is unavailable. Please try again.');
    terminal.press('Enter');
    calls[0].handlers.onText('Stale text');
    calls[0].handlers.onDone();
    expect(terminal.input.readOnly).toBe(true);
    expect(terminal.answers()).toHaveLength(0);
    calls[1].handlers.onText('Recovered');
    calls[1].handlers.onDone();
    calls[1].handlers.onDone();
    calls[1].handlers.onError('Late error');
    expect(terminal.answers()).toHaveLength(1);
    expect(terminal.answers()[0].textContent).toBe('Recovered');
    expect(terminal.input.value).toBe('');
  });

  test.each(['throw', 'reject', 'missing callback', 'empty done'])('%s cannot leave a turn locked', async (failure) => {
    const terminal = createTerminal({
      busy: () => false,
      ask(_question, handlers) {
        if (failure === 'throw') throw new Error('SECRET');
        if (failure === 'reject') return Promise.reject(new Error('SECRET'));
        if (failure === 'empty done') handlers.onDone();
        return Promise.resolve();
      },
    });
    terminal.setLine('Keep my draft');
    terminal.press('Enter');
    await Promise.resolve();
    expect(terminal.input.readOnly).toBe(false);
    expect(terminal.loader.hidden).toBe(true);
    expect(terminal.input.value).toBe('Keep my draft');
    expect(terminal.status.textContent).toBe('The assistant is unavailable. Please try again.');
  });
});
