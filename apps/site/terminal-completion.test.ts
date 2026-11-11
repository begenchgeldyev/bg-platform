import { describe, expect, test } from 'bun:test';
import type { AskChat } from './client/ask-chat';

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
  value = '';
  selectionStart = 0;
  selectionEnd = 0;
  private text = '';
  handlers: Record<string, Array<(event: StubEvent) => void>> = {};
  queries = new Map<string, StubElement>();

  constructor(public id: string) {}

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
  for (const id of ['terminal-wrap', 'terminal-body', 'input-line', 'terminal-input', 'terminal-display', 'last-login']) {
    elements.set(id, new StubElement(id));
  }

  const body = elements.get('terminal-body') as StubElement;
  const inputLine = elements.get('input-line') as StubElement;
  const input = elements.get('terminal-input') as StubElement;
  const display = elements.get('terminal-display') as StubElement;
  body.children.push(inputLine);

  const documentStub = {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string) => new StubElement(tag),
  };
  const navigations: string[] = [];
  const opened: string[] = [];
  const windowStub = {
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
    display,
    appended,
    body,
    navigations,
    opened,
    press(key: string) {
      input.dispatch('keydown', { key, preventDefault() {} });
    },
    setLine(value: string, caret = value.length) {
      input.value = value;
      input.setSelectionRange(caret, caret);
      display.textContent = value;
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
    expect(terminal.display.textContent).toBe('cat philosophy.txt');
    expect(terminal.input.selectionStart).toBe('cat philosophy.txt'.length);
    expect(terminal.input.selectionEnd).toBe('cat philosophy.txt'.length);
  });

  test('cat sk completes skills.txt', () => {
    const terminal = createTerminal();
    terminal.setLine('cat sk');

    terminal.pressTab();

    expect(terminal.input.value).toBe('cat skills.txt');
    expect(terminal.display.textContent).toBe('cat skills.txt');
  });

  test('cat co completes contact.txt', () => {
    const terminal = createTerminal();
    terminal.setLine('cat co');

    terminal.pressTab();

    expect(terminal.input.value).toBe('cat contact.txt');
    expect(terminal.display.textContent).toBe('cat contact.txt');
  });

  test('open gi completes github and open li completes linkedin', () => {
    const github = createTerminal();
    github.setLine('open gi');
    github.pressTab();
    expect(github.input.value).toBe('open github');
    expect(github.display.textContent).toBe('open github');

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
    expect(terminal.display.textContent).toBe('open gh');
    expect(terminal.appended()).toBe('');
  });

  test('open cv is an exact existing token and stays unchanged', () => {
    const terminal = createTerminal();
    terminal.setLine('open cv');

    terminal.pressTab();

    expect(terminal.input.value).toBe('open cv');
    expect(terminal.display.textContent).toBe('open cv');
    expect(terminal.appended()).toBe('');
  });

  test('command prefix completes against the existing command table', () => {
    const terminal = createTerminal();
    terminal.setLine('pro');

    terminal.pressTab();

    expect(terminal.input.value).toBe('projects');
    expect(terminal.display.textContent).toBe('projects');
  });

  test('command prefix keeps following arguments and whitespace', () => {
    const terminal = createTerminal();
    terminal.setLine('who  me', 3);

    terminal.pressTab();

    expect(terminal.input.value).toBe('whoami  me');
    expect(terminal.display.textContent).toBe('whoami  me');
  });

  test('empty cat argument lists files without mutating the line', () => {
    const terminal = createTerminal();
    terminal.setLine('cat ');

    terminal.pressTab();

    expect(terminal.input.value).toBe('cat ');
    expect(terminal.display.textContent).toBe('cat ');
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
    expect(terminal.display.textContent).toBe('c');
    const listed = terminal.appended();
    expect(listed).toContain('cat');
    expect(listed).toContain('clear');
  });

  test('no-match argument is unchanged with no output', () => {
    const terminal = createTerminal();
    terminal.setLine('cat zzz');

    terminal.pressTab();

    expect(terminal.input.value).toBe('cat zzz');
    expect(terminal.display.textContent).toBe('cat zzz');
    expect(terminal.appended()).toBe('');
  });

  test('middle-caret argument completion preserves suffix and caret', () => {
    const terminal = createTerminal();
    terminal.setLine('cat phi extra', 'cat phi'.length);

    terminal.pressTab();

    expect(terminal.input.value).toBe('cat philosophy.txt extra');
    expect(terminal.display.textContent).toBe('cat philosophy.txt extra');
    expect(terminal.input.selectionStart).toBe('cat philosophy.txt'.length);
    expect(terminal.input.selectionEnd).toBe('cat philosophy.txt'.length);
  });

  test('middle-caret command completion preserves the rest of the line', () => {
    const terminal = createTerminal();
    terminal.setLine('pro later args', 3);

    terminal.pressTab();

    expect(terminal.input.value).toBe('projects later args');
    expect(terminal.display.textContent).toBe('projects later args');
    expect(terminal.input.selectionStart).toBe('projects'.length);
  });

  test('double spaces between command and argument are preserved', () => {
    const terminal = createTerminal();
    terminal.setLine('cat  phi');

    terminal.pressTab();

    expect(terminal.input.value).toBe('cat  philosophy.txt');
    expect(terminal.display.textContent).toBe('cat  philosophy.txt');
  });

  test('caret in a later token refuses to rewrite the line', () => {
    const terminal = createTerminal();
    terminal.setLine('cat phi extra', 'cat phi extra'.length);

    terminal.pressTab();

    expect(terminal.input.value).toBe('cat phi extra');
    expect(terminal.display.textContent).toBe('cat phi extra');
  });

  test('Shift+Tab is not captured and keeps native focus traversal', () => {
    const terminal = createTerminal();
    terminal.setLine('cat phi');

    const prevented = terminal.pressTab({ shift: true });

    expect(prevented).toBe(false);
    expect(terminal.input.value).toBe('cat phi');
    expect(terminal.display.textContent).toBe('cat phi');
    expect(terminal.appended()).toBe('');
  });
});

describe('direct terminal AI', () => {
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
    expect(terminal.display.textContent).toBe('open your best project');
  });

  test('prose and streamed errors remain inert text, including entity-encoded markup', () => {
    const unsafe = '<img src=x onerror=alert(1)>&lt;script&gt;';
    const terminal = createTerminal({
      busy: () => false,
      ask: async (_question, handlers) => {
        handlers.onText(unsafe);
      },
    });
    terminal.setLine(`What is ${unsafe}?`);
    terminal.press('Enter');
    expect(terminal.appended()).not.toContain(unsafe);
    expect(terminal.appended()).toContain('&amp;lt;script&amp;gt;');
    const line = terminal.body.children.find((child) => child.queries.has('[data-answer]'));
    expect(line?.querySelector('[data-answer]').textContent).toBe(unsafe);
    expect(line?.querySelector('[data-answer]').innerHTML).toBe('');
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
    expect(terminal.appended()).toContain('still answering');
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

  test('retains literal manual commands and ask alias, safely escapes user echo/errors', () => {
    const questions: string[] = [];
    const terminal = createTerminal({
      busy: () => false,
      ask: async (question) => {
        questions.push(question);
      },
    });
    for (const line of ['whoami', 'cat philosophy.txt', 'ask Where do you work?', 'cat <img&x>']) {
      terminal.setLine(line);
      terminal.press('Enter');
    }
    expect(questions).toEqual(['Where do you work?']);
    expect(terminal.appended()).toContain('Performance is not a feature');
    expect(terminal.appended()).not.toContain('<img&x>');
    expect(terminal.appended()).toContain('&lt;img&amp;x&gt;');
  });
});
