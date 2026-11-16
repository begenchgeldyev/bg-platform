import { describe, expect, test } from 'bun:test';

type CopyEvent = { target: object; button: number; detail: number; preventDefault: () => void };

async function runtime(writeText?: (text: string) => Promise<void>) {
  const listeners = new Map<string, ((event: CopyEvent) => void)[]>();
  const status = { textContent: '' };
  const button = {
    dataset: { copyEmail: 'begenchgeldyev@gmail.com', copySuccess: 'Copied', copyFailure: 'Select and copy the email address.' },
    isConnected: true,
    getAttribute: () => 'email-copy-status',
    closest: () => button,
  };
  const document = {
    addEventListener: (name: string, callback: (event: CopyEvent) => void) =>
      listeners.set(name, [...(listeners.get(name) ?? []), callback]),
    getElementById: () => status,
  };
  const window = {};
  const timers: (() => void)[] = [];
  const script = new Function(
    'window',
    'document',
    'navigator',
    'setTimeout',
    'clearTimeout',
    await Bun.file(new URL('./public/email-copy.js', import.meta.url)).text(),
  );
  const run = () =>
    script(
      window,
      document,
      { clipboard: writeText ? { writeText } : undefined },
      (fn: () => void) => timers.push(fn),
      () => {},
    );
  run();
  const fire = async (name: string, detail = 0, extra = {}) => {
    for (const listener of listeners.get(name) ?? []) listener({ target: button, button: 0, detail, preventDefault() {}, ...extra });
    await Promise.resolve();
    await Promise.resolve();
  };
  return { run, fire, status, timers, listeners };
}

describe('email copy', () => {
  test('copies on primary mousedown only once and announces success', async () => {
    const writes: string[] = [];
    const r = await runtime(async (text) => {
      writes.push(text);
    });
    await r.fire('mousedown', 1);
    await r.fire('click', 1);
    expect(writes).toEqual(['begenchgeldyev@gmail.com']);
    expect(r.status.textContent).toBe('Copied');
    r.timers.at(-1)?.();
    expect(r.status.textContent).toBe('');
  });
  test('supports keyboard and touch-only click and remains singleton after script reexecution', async () => {
    let writes = 0;
    const r = await runtime(async () => {
      writes++;
    });
    r.run();
    await r.fire('click', 0);
    await r.fire('click', 1);
    expect(writes).toBe(2);
    expect(r.listeners.get('click')).toHaveLength(1);
  });
  test.each(['missing', 'denied'])('reports %s clipboard without false success', async (mode) => {
    const r = await runtime(
      mode === 'missing'
        ? undefined
        : async () => {
            throw new Error('denied');
          },
    );
    await r.fire('click');
    expect(r.status.textContent).toBe('Select and copy the email address.');
  });
  test('ignores non-primary mousedown', async () => {
    let writes = 0;
    const r = await runtime(async () => {
      writes++;
    });
    await r.fire('mousedown', 1, { button: 2 });
    expect(writes).toBe(0);
  });
});
