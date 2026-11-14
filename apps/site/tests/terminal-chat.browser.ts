// SITE_URL=http://localhost:8614 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs bun apps/site/tests/terminal-chat.browser.ts
// Fail-closed: /api/ask is mocked at fetch, with a network abort guard underneath.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.SITE_URL || 'http://localhost:8614';
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/terminal-chat-ux';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
type Handlers = { onText(text: string): void; onDone(): void; onError(message: string): void };
declare global {
  interface Window {
    askChat: { busy(): boolean; ask(question: string, handlers: Handlers): Promise<void> };
    terminalMock: { requests: string[]; chunk(text: string): void; done(): void; fail(): void; nextStatus: number };
    terminalHandlers: Handlers[];
    terminalStatusUpdates: string[];
  }
}

function mockChat() {
  const realFetch = window.fetch.bind(window);
  const encoder = new TextEncoder();
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const send = (event: object) => stream?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  const close = () => {
    stream?.enqueue(encoder.encode('data: [DONE]\n\n'));
    stream?.close();
  };
  window.terminalMock = {
    requests: [],
    nextStatus: 200,
    chunk(text) {
      send({ type: 'text-delta', id: 'text', delta: text });
    },
    done() {
      send({ type: 'text-end', id: 'text' });
      send({ type: 'finish', finishReason: 'stop' });
      close();
    },
    fail() {
      send({ type: 'error', errorText: 'PRIVATE provider failure' });
      close();
    },
  };
  window.fetch = (async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource), location.href);
    if (url.pathname !== '/api/ask') return realFetch(resource, init);
    const body = typeof init?.body === 'string' ? init.body : resource instanceof Request ? await resource.clone().text() : '';
    window.terminalMock.requests.push(body);
    if (window.terminalMock.nextStatus !== 200) {
      const status = window.terminalMock.nextStatus;
      window.terminalMock.nextStatus = 200;
      return new Response(JSON.stringify({ error: status === 429 ? 'rate limit reached, try again in a few minutes' : 'private error' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const response = new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
      },
    });
    send({ type: 'start', messageId: `mock-${window.terminalMock.requests.length}` });
    send({ type: 'text-start', id: 'text' });
    return new Response(response, { headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } });
  }) as typeof window.fetch; // Bun's ambient fetch adds preconnect; this function runs only in Chromium.
}

const report: unknown[] = [];
let escapedRequests = 0;
try {
  for (const lang of ['en', 'ru']) {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
      await context.route('**/api/ask', (route: { abort(): Promise<void> }) => {
        escapedRequests++;
        return route.abort();
      });
      await context.addInitScript(mockChat);
      await context.addCookies([{ name: 'lang', value: lang, url: baseURL }]);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error: Error) => errors.push(error.message));
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean(window.askChat));
      await page.evaluate(() => {
        window.terminalStatusUpdates = [];
        const status = document.getElementById('terminal-status') as HTMLElement;
        new MutationObserver(() => window.terminalStatusUpdates.push(status.textContent ?? '')).observe(status, { childList: true });
      });
      const input = page.locator('#terminal-input');
      const terminal = page.locator('#terminal-wrap');
      await input.scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#last-login, #terminal-wrap .blinking-cursor').count(), 0);
      assert.equal(await input.isVisible(), true);
      assert.equal(await input.evaluate((element: Element) => getComputedStyle(element).opacity), '1');
      await terminal.screenshot({ path: `${output}/chat-${lang}-${width}-idle.png` });
      await input.fill('   ');
      await input.press('Enter');
      await input.fill('IME question');
      await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
      assert.equal(await input.inputValue(), 'IME question');
      assert.equal(await page.locator('[data-user-message]').count(), 0);
      assert.equal(await page.evaluate(() => window.terminalMock.requests.length), 0);
      await input.fill('What does Begench build?');
      await input.press('Enter');
      await page.waitForFunction(() => window.terminalMock.requests.length === 1);
      await input.press('Enter');
      await input.press('Enter');
      await input.press('ArrowUp');
      await input.press('Control+l');
      assert.equal(await input.inputValue(), '');
      assert.equal(await input.getAttribute('readonly'), '');
      assert.equal(await page.locator('#terminal-prompt').isVisible(), false);
      assert.equal(await page.locator('[data-user-message]').count(), 1);
      assert.equal(await page.locator('[data-answer]').count(), 0);
      assert.equal((await terminal.textContent()).includes(lang === 'en' ? 'Assistant:' : 'Помощник:'), false);
      assert.equal(await page.locator('#terminal-intro').count(), 0);
      assert.equal(await input.getAttribute('placeholder'), lang === 'en' ? 'Preparing a reply…' : 'Готовлю ответ…');
      assert.equal(await input.evaluate((element: Element) => document.activeElement === element), true);
      const scrollBefore = await page.evaluate(() => ({ page: scrollY, terminal: document.getElementById('terminal-body')?.scrollTop }));
      const pixels = await page.evaluate(async () => {
        const nodes = [...document.querySelectorAll('#terminal-loader > span')];
        const samples: string[][] = [];
        for (let step = 0; step < 5; step++) {
          samples.push(nodes.map((node) => getComputedStyle(node).opacity));
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return {
          samples,
          dimensions: nodes.map((node) => ({
            width: getComputedStyle(node).width,
            height: getComputedStyle(node).height,
            duration: getComputedStyle(node).animationDuration,
          })),
          gap: getComputedStyle(document.getElementById('terminal-loader') as Element).gap,
        };
      });
      assert.equal(
        new Set(pixels.samples.map((sample: string[]) => sample.join(','))).size > 1,
        true,
        'real pixel animation changes opacity',
      );
      assert.ok(
        pixels.dimensions.every(
          (pixel: { width: string; height: string; duration: string }) =>
            pixel.width === '4px' && pixel.height === '4px' && pixel.duration === '0.9s',
        ),
      );
      assert.equal(pixels.gap, '3px');
      await terminal.screenshot({ path: `${output}/chat-${lang}-${width}-waiting.png` });
      await page.evaluate(() => window.terminalMock.chunk('Begench builds '));
      await page.waitForTimeout(150);
      await page.evaluate(() => window.terminalMock.chunk('readable web systems.'));
      await page.waitForTimeout(150);
      assert.equal(await page.locator('[data-answer]').count(), 0);
      assert.equal((await page.locator('#terminal-body').textContent()).includes('readable web systems'), false);
      assert.deepEqual(
        await page.evaluate(() => ({ page: scrollY, terminal: document.getElementById('terminal-body')?.scrollTop })),
        scrollBefore,
      );
      assert.equal(await page.evaluate(() => window.terminalMock.requests.length), 1);
      assert.deepEqual(
        await page.evaluate(() => window.terminalStatusUpdates),
        [lang === 'en' ? 'Preparing a reply…' : 'Готовлю ответ…'],
        'one waiting announcement, no token updates',
      );
      await input.press('Shift+Tab');
      assert.equal(
        await page.locator('[data-terminal-fullscreen]').evaluate((element: Element) => document.activeElement === element),
        true,
      );
      await page.keyboard.press('Tab');
      assert.equal(await input.evaluate((element: Element) => document.activeElement === element), true);
      await page.locator('[data-terminal-fullscreen]').click();
      await page.waitForFunction(() => document.fullscreenElement?.id === 'terminal-wrap');
      assert.equal(await input.evaluate((element: Element) => document.activeElement === element), true);
      assert.equal(await input.getAttribute('readonly'), '');
      await page.screenshot({ path: `${output}/chat-${lang}-${width}-fullscreen-waiting.png` });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.fullscreenElement);
      await page.evaluate(() => window.terminalMock.done());
      await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('#terminal-input')?.readOnly);
      assert.equal(await page.locator('[data-answer]').textContent(), 'Begench builds readable web systems.');
      assert.equal(await page.locator('[data-answer]').count(), 1);
      assert.equal(await page.locator('#terminal-prompt').isVisible(), true);
      assert.equal(await page.locator('#terminal-loader').isVisible(), false);
      assert.equal(await page.locator('#terminal-input').count(), 1);
      assert.equal(
        await page.locator('[data-terminal-fullscreen]').evaluate((element: Element) => document.activeElement === element),
        true,
        'completion does not steal focus',
      );
      assert.equal(
        await page.locator('#terminal-loader').evaluate((element: Element) => element.getAnimations({ subtree: true }).length),
        0,
      );
      await terminal.screenshot({ path: `${output}/chat-${lang}-${width}-complete.png` });
      // Partial stream failure must never publish its buffer or auto-retry.
      await input.fill('Keep this retry draft');
      await input.press('Enter');
      await page.waitForFunction(() => window.terminalMock.requests.length === 2);
      await page.evaluate(() => window.terminalMock.chunk('PRIVATE PARTIAL'));
      await page.waitForTimeout(80);
      await page.evaluate(() => window.terminalMock.fail());
      await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('#terminal-input')?.readOnly);
      assert.equal(await input.inputValue(), 'Keep this retry draft');
      assert.equal(await page.locator('[data-answer]').count(), 1);
      assert.equal((await page.locator('#terminal-body').textContent()).includes('PRIVATE'), false);
      assert.ok((await page.locator('[data-chat-error]').textContent()).includes(lang === 'en' ? 'try again' : 'Попробуйте'));
      await terminal.screenshot({ path: `${output}/chat-${lang}-${width}-error.png` });
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => window.terminalMock.requests.length), 2);
      await input.press('Enter');
      await page.waitForFunction(() => window.terminalMock.requests.length === 3);
      await page.evaluate(() => {
        window.terminalMock.chunk('Recovered.');
        window.terminalMock.done();
      });
      await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('#terminal-input')?.readOnly);
      assert.equal(await page.locator('[data-answer]').last().textContent(), 'Recovered.');
      assert.equal(await page.locator('[data-user-message]').count(), 3);
      await input.press('ArrowUp');
      assert.equal(await input.inputValue(), 'Keep this retry draft');
      await input.fill('cat phi');
      await input.press('Tab');
      assert.equal(await input.inputValue(), 'cat philosophy.txt');
      await input.press('Enter');
      assert.ok((await page.locator('#terminal-body').textContent()).includes('Performance is not a feature'));
      await input.press('ArrowUp');
      assert.equal(await input.inputValue(), 'cat philosophy.txt');
      assert.equal(await page.evaluate(() => window.terminalMock.requests.length), 3, 'manual commands stay local');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      report.push({ lang, width, pixels, mockedRequests: 3, errors });
      console.log(`PASS chat states/pixels/guards/retry/focus/manual/fullscreen ${lang} ${width}`);
      await context.close();
    }
  }

  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  await context.route('**/api/ask', (route: { abort(): Promise<void> }) => {
    escapedRequests++;
    return route.abort();
  });
  await context.addInitScript(mockChat);
  const page = await context.newPage();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.askChat));
  const input = page.locator('#terminal-input');
  await input.fill('A long answer please');
  await input.press('Enter');
  await page.waitForFunction(() => window.terminalMock.requests.length === 1);
  await page.locator('[data-terminal-fullscreen]').focus();
  await page.evaluate(() => {
    window.terminalMock.chunk(
      Array.from({ length: 70 }, (_, index) => `Paragraph ${index}: readable text, without any live rendering.`).join('\n\n'),
    );
    window.terminalMock.done();
  });
  await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('#terminal-input')?.readOnly);
  const beginning = await page.evaluate(() => {
    const body = document.getElementById('terminal-body') as HTMLElement;
    const answer = document.querySelector('[data-answer]') as HTMLElement;
    return {
      offset: answer.getBoundingClientRect().top - body.getBoundingClientRect().top,
      remaining: body.scrollHeight - body.scrollTop - body.clientHeight,
    };
  });
  assert.ok(Math.abs(beginning.offset) <= 3, 'beginning of long reply is visible, not its end');
  assert.ok(beginning.remaining > 1000);
  await page.locator('#terminal-wrap').screenshot({ path: `${output}/chat-long-answer-beginning.png` });
  await input.fill('Let me read the earlier reply');
  await input.press('Enter');
  await page.waitForFunction(() => window.terminalMock.requests.length === 2);
  await page.locator('header a[href="/cv"]').focus();
  await page.evaluate(() => {
    const body = document.getElementById('terminal-body') as HTMLElement;
    body.scrollTop = 0;
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-answer]') as Node);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  });
  const before = await page.evaluate(() => ({
    page: scrollY,
    body: document.getElementById('terminal-body')?.scrollTop,
    selection: getSelection()?.toString(),
  }));
  await page.evaluate(() => window.terminalMock.chunk('No viewport stealing.'));
  await page.waitForTimeout(120);
  await page.evaluate(() => window.terminalMock.done());
  await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('#terminal-input')?.readOnly);
  assert.deepEqual(
    await page.evaluate(() => ({
      page: scrollY,
      body: document.getElementById('terminal-body')?.scrollTop,
      selection: getSelection()?.toString(),
    })),
    before,
  );
  assert.equal(await page.locator('header a[href="/cv"]').evaluate((element: Element) => document.activeElement === element), true);
  // A live selection outranks click-to-focus; clearing it hands the prompt back.
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await page
    .locator('[data-answer]')
    .first()
    .click({ position: { x: 50, y: 10 } });
  assert.equal(
    await input.evaluate((element: Element) => document.activeElement === element),
    true,
    'transcript click returns to the composer',
  );
  console.log('PASS long answer begins in view; reader scroll/selection survive; a transcript click returns to the prompt');
  await context.close();

  for (const lang of ['en', 'ru']) {
    const context = await browser.newContext({ baseURL, viewport: { width: 320, height: 800 }, reducedMotion: 'reduce' });
    await context.route('**/api/ask', (route: { abort(): Promise<void> }) => {
      escapedRequests++;
      return route.abort();
    });
    await context.addInitScript(mockChat);
    await context.addCookies([{ name: 'lang', value: lang, url: baseURL }]);
    const page = await context.newPage();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.askChat));
    await page.locator('#terminal-input').fill('Reduced motion');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForFunction(() => window.terminalMock.requests.length === 1);
    const staticPixels = await page
      .locator('#terminal-loader > span')
      .evaluateAll((nodes: Element[]) =>
        nodes.map((node) => ({ animation: getComputedStyle(node).animationName, opacity: getComputedStyle(node).opacity })),
      );
    assert.ok(
      staticPixels.every((pixel: { animation: string; opacity: string }) => pixel.animation === 'none' && pixel.opacity === '0.65'),
    );
    await page.locator('#terminal-wrap').screenshot({ path: `${output}/chat-${lang}-reduced-waiting.png` });
    await page.evaluate(() => {
      window.terminalMock.chunk('Finished.');
      window.terminalMock.done();
    });
    await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('#terminal-input')?.readOnly);
    await page.evaluate(() => {
      window.terminalMock.nextStatus = 429;
    });
    await page.locator('#terminal-input').fill('A rate-limited request');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForFunction(() => Boolean(document.querySelector('[data-chat-error]')));
    assert.equal(await page.locator('#terminal-input').inputValue(), 'A rate-limited request');
    assert.ok((await page.locator('[data-chat-error]').textContent()).includes(lang === 'en' ? 'few minutes' : 'несколько минут'));
    assert.equal(await page.locator('#terminal-loader').isVisible(), false);
    console.log(`PASS static reduced-motion pixels and localized HTTP error ${lang}`);
    await context.close();
  }
  const failures = await browser.newContext({ baseURL });
  await failures.route('**/api/ask', (route: { abort(): Promise<void> }) => {
    escapedRequests++;
    return route.abort();
  });
  await failures.addInitScript(mockChat);
  const failedPage = await failures.newPage();
  const failureExceptions: string[] = [];
  failedPage.on('pageerror', (error: Error) => failureExceptions.push(error.message));
  await failedPage.goto('/', { waitUntil: 'domcontentloaded' });
  await failedPage.waitForFunction(() => Boolean(window.askChat));
  await failedPage.evaluate(() => {
    window.askChat.ask = () => Promise.reject(new Error('PRIVATE rejection'));
  });
  await failedPage.locator('#terminal-input').fill('Retry after rejection');
  await failedPage.locator('#terminal-input').press('Enter');
  await failedPage.waitForFunction(() => Boolean(document.querySelector('[data-chat-error]')));
  assert.equal(await failedPage.locator('#terminal-input').inputValue(), 'Retry after rejection');
  assert.equal(await failedPage.locator('#terminal-input').getAttribute('readonly'), null);
  await failedPage.evaluate(() => {
    window.terminalHandlers = [];
    window.askChat = {
      busy: () => false,
      ask(_question, handlers) {
        window.terminalHandlers.push(handlers);
        return new Promise(() => {});
      },
    };
  });
  await failedPage.locator('#terminal-input').press('Enter');
  await failedPage.evaluate(() => {
    window.terminalHandlers[0]?.onText('PRIVATE partial');
    window.terminalHandlers[0]?.onError('PRIVATE failure');
  });
  await failedPage.locator('#terminal-input').press('Enter');
  await failedPage.evaluate(() => {
    window.terminalHandlers[0]?.onText('Stale text');
    window.terminalHandlers[0]?.onDone();
  });
  assert.equal(await failedPage.locator('#terminal-input').getAttribute('readonly'), '');
  assert.equal(await failedPage.locator('[data-answer]').count(), 0);
  await failedPage.evaluate(() => {
    const current = window.terminalHandlers[1];
    current?.onText('Exactly one safe final answer.');
    current?.onDone();
    current?.onDone();
    current?.onError('Late failure');
  });
  assert.equal(await failedPage.locator('[data-answer]').count(), 1);
  assert.equal(await failedPage.locator('[data-answer]').textContent(), 'Exactly one safe final answer.');
  assert.equal((await failedPage.locator('#terminal-body').textContent()).includes('PRIVATE'), false);
  assert.equal(await failedPage.locator('#terminal-input').getAttribute('readonly'), null);
  assert.deepEqual(failureExceptions, []);
  await failedPage.locator('#terminal-wrap').screenshot({ path: `${output}/chat-rejected-and-stale-callbacks.png` });
  await failures.close();
  console.log('PASS rejected promise and stale/duplicate callbacks recover once, without unhandled errors');
  assert.equal(escapedRequests, 0, 'no real API request escaped the deterministic mock');
} finally {
  await Bun.write(`${output}/browser-report.json`, JSON.stringify({ cases: report, escapedRequests }, null, 2));
  await browser.close();
}
