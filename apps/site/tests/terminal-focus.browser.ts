// SITE_URL=http://localhost:8625 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs bun apps/site/tests/terminal-focus.browser.ts
// Load-time prompt focus, preventScroll, coarse-pointer opt-out, settle refocus and border independence.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.SITE_URL || 'http://localhost:8625';
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/terminal-autofocus';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
type Handlers = { onText(text: string): void; onDone(): void; onError(message: string): void };
declare global {
  interface Window {
    askChat: { busy(): boolean; ask(message: string, handlers: Handlers): Promise<void> };
    pendingAsk: Handlers;
  }
}
const report: unknown[] = [];
let escapedRequests = 0;
const blockAsk = (context: { route(pattern: string, handler: (route: { abort(): Promise<void> }) => Promise<void>): Promise<void> }) =>
  context.route('**/api/ask', (route) => {
    escapedRequests++;
    return route.abort();
  });
const inputIsActive = (element: Element) => document.activeElement === element;

try {
  for (const lang of ['en', 'ru']) {
    // 1. Desktop: a fine-pointer load lands in the prompt without scrolling.
    const desktop = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    await blockAsk(desktop);
    await desktop.addCookies([{ name: 'lang', value: lang, url: baseURL }]);
    const page = await desktop.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error: Error) => errors.push(error.message));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.fonts.ready);
    const input = page.locator('#terminal-input');
    const headerLink = page.locator('header a[href="/cv"]');
    const loaded = await page.evaluate(() => ({
      focused: document.activeElement === document.getElementById('terminal-input'),
      pointerFine: matchMedia('(pointer: fine)').matches,
      scrollY,
    }));
    assert.equal(loaded.pointerFine, true, 'a plain desktop context reports a fine primary pointer');
    assert.equal(loaded.focused, true, 'the prompt owns focus as soon as / renders');
    assert.equal(loaded.scrollY, 0, 'load focus never scrolls the page');
    await page.screenshot({ path: `${output}/focus-${lang}-desktop-loaded.png` });
    console.log(`PASS load focus without scroll ${lang} 1440x900`);

    // 4a. A settled reply hands the prompt back; typing needs no click at all.
    await page.evaluate(() => {
      window.askChat = {
        busy: () => false,
        ask: (_message, options) => {
          window.pendingAsk = options;
          return new Promise(() => {});
        },
      };
    });
    await page.keyboard.type('hello');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Boolean(document.querySelector('[data-user-message]')));
    assert.equal(await input.getAttribute('readonly'), '', 'the prompt is locked while the reply streams');
    await page.evaluate(() => {
      window.pendingAsk.onText('Answer');
      window.pendingAsk.onDone();
    });
    await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('#terminal-input')?.readOnly);
    assert.equal(await input.evaluate(inputIsActive), true, 'settling returns focus to the prompt');
    assert.equal(await input.inputValue(), '', 'the handed-back prompt is empty');
    await page.screenshot({ path: `${output}/focus-${lang}-settled.png` });
    console.log(`PASS settled reply returns focus to the empty prompt ${lang}`);

    // 4b. Focus already claimed elsewhere is never stolen on settle.
    await page.keyboard.type('and again');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('[data-user-message]').length === 2);
    await headerLink.focus();
    await page.evaluate(() => {
      window.pendingAsk.onText('Second answer');
      window.pendingAsk.onDone();
    });
    await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('#terminal-input')?.readOnly);
    assert.equal(await headerLink.evaluate(inputIsActive), true, 'settle leaves an already focused control alone');
    console.log(`PASS settle does not steal focus from another control ${lang}`);

    // 5. The wrapper border carries no focus state; the caret is the only cue.
    const borderColor = () => page.locator('#terminal-wrap').evaluate((element: Element) => getComputedStyle(element).borderTopColor);
    await input.focus();
    const focusedBorder = await borderColor();
    await headerLink.focus();
    const idleBorder = await borderColor();
    assert.equal(focusedBorder, idleBorder, 'the terminal border is identical with and without prompt focus');
    assert.notEqual(focusedBorder, 'rgb(0, 255, 65)', 'no green focus border remains');
    await page.screenshot({ path: `${output}/focus-${lang}-border.png` });
    console.log(`PASS terminal border is focus-independent ${lang} (${focusedBorder})`);

    // 6. Any click in the terminal returns to the prompt, unless a selection is live.
    await headerLink.focus();
    await page
      .locator('[data-answer]')
      .first()
      .click({ position: { x: 40, y: 8 } });
    assert.equal(await input.evaluate(inputIsActive), true, 'clicking the transcript focuses the prompt');
    await page.locator('[data-terminal-toolbar]').click({ position: { x: 12, y: 12 } });
    assert.equal(await input.evaluate(inputIsActive), true, 'clicking the chrome focuses the prompt');
    const keptFocus = await page.evaluate(() => {
      const answer = document.querySelector('[data-answer]') as Element;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const range = document.createRange();
      range.selectNodeContents(answer);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      answer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return document.activeElement?.id ?? '';
    });
    assert.notEqual(keptFocus, 'terminal-input', 'a live text selection keeps focus away from the prompt');
    assert.ok((await page.evaluate(() => getSelection()?.toString() ?? '')).length > 0);
    await page.evaluate(() => getSelection()?.removeAllRanges());
    console.log(`PASS terminal clicks return to the prompt unless text is selected ${lang}`);

    // 1b. A history return re-runs the component, so the prompt takes focus again.
    await page.goto('/cv', { waitUntil: 'domcontentloaded' });
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await input.evaluate(inputIsActive), true, 'back navigation focuses the prompt again');
    console.log(`PASS back navigation focuses the prompt ${lang}`);

    assert.deepEqual(errors, []);
    report.push({ lang, case: 'desktop', loaded, focusedBorder, idleBorder, errors });
    await desktop.close();

    // 2. The prompt sits below the fold here, so scrollY === 0 proves preventScroll.
    const offscreen = await browser.newContext({ baseURL, viewport: { width: 390, height: 560 } });
    await blockAsk(offscreen);
    await offscreen.addCookies([{ name: 'lang', value: lang, url: baseURL }]);
    const small = await offscreen.newPage();
    const smallErrors: string[] = [];
    small.on('pageerror', (error: Error) => smallErrors.push(error.message));
    await small.goto('/', { waitUntil: 'domcontentloaded' });
    await small.evaluate(() => document.fonts.ready);
    const geometry = await small.evaluate(() => {
      const prompt = document.getElementById('terminal-input') as HTMLInputElement;
      return {
        top: prompt.getBoundingClientRect().top,
        innerHeight,
        focused: document.activeElement === prompt,
        pointerFine: matchMedia('(pointer: fine)').matches,
        scrollY,
      };
    });
    assert.equal(geometry.pointerFine, true, 'no touch emulation: still a fine pointer');
    assert.ok(geometry.top > geometry.innerHeight, `the prompt starts below the fold (${geometry.top} > ${geometry.innerHeight})`);
    assert.equal(geometry.focused, true, 'an off-screen prompt is still focused');
    assert.equal(geometry.scrollY, 0, 'preventScroll keeps the page offset at zero');
    await small.screenshot({ path: `${output}/focus-${lang}-offscreen.png` });
    assert.deepEqual(smallErrors, []);
    report.push({ lang, case: 'offscreen', geometry, errors: smallErrors });
    console.log(`PASS off-screen prompt focuses without scrolling ${lang} 390x560`);
    await offscreen.close();

    // 3. A touch-first device gets no keyboard on load.
    const touch = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await blockAsk(touch);
    await touch.addCookies([{ name: 'lang', value: lang, url: baseURL }]);
    const phone = await touch.newPage();
    const phoneErrors: string[] = [];
    phone.on('pageerror', (error: Error) => phoneErrors.push(error.message));
    await phone.goto('/', { waitUntil: 'domcontentloaded' });
    await phone.evaluate(() => document.fonts.ready);
    const coarse = await phone.evaluate(() => ({
      activeId: document.activeElement?.id ?? '',
      pointerFine: matchMedia('(pointer: fine)').matches,
      scrollY,
    }));
    assert.equal(coarse.pointerFine, false, 'touch emulation reports a coarse primary pointer');
    assert.notEqual(coarse.activeId, 'terminal-input', 'a coarse pointer gets no load focus');
    assert.equal(coarse.scrollY, 0);
    await phone.screenshot({ path: `${output}/focus-${lang}-coarse.png` });
    assert.deepEqual(phoneErrors, []);
    report.push({ lang, case: 'coarse', coarse, errors: phoneErrors });
    console.log(`PASS coarse pointer gets no load focus ${lang} 390x844`);
    await touch.close();
  }
  assert.equal(escapedRequests, 0, 'the stubbed client never reaches the AI endpoint');
} finally {
  await Bun.write(`${output}/report.json`, JSON.stringify({ cases: report, escapedRequests }, null, 2));
  await browser.close();
}
