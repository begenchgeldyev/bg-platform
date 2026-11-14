// SITE_URL=http://localhost:8614 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs bun apps/site/tests/hero-focus.browser.ts
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.SITE_URL || 'http://localhost:8614';
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/return-home/headline-focus';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
const report: unknown[] = [];
let aiRequests = 0;
try {
  for (const lang of ['en', 'ru']) {
    const context = await browser.newContext({ baseURL });
    await context.addCookies([{ name: 'lang', value: lang, url: baseURL }]);
    for (const width of [320, 390, 1440]) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on('pageerror', (error: Error) => errors.push(error.message));
      const cdp = await context.newCDPSession(page);
      cdp.on('Fetch.requestPaused', async (event: { requestId: string }) => {
        aiRequests++;
        await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
      });
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/ask*' }] });
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      const title = page.locator('[data-role-switch]');
      const style = () =>
        title.evaluate((button: Element) => {
          const text = button.querySelector(':scope > [aria-hidden="true"]') as Element;
          const word = button.querySelector('[data-role-word]') as Element;
          return {
            visibleFocus: button.matches(':focus-visible'),
            outline: getComputedStyle(button).outlineStyle,
            line: getComputedStyle(text).textDecorationLine,
            wordLine: getComputedStyle(word).textDecorationLine,
            thickness: getComputedStyle(text).textDecorationThickness,
            offset: getComputedStyle(text).textUnderlineOffset,
            colors: [getComputedStyle(word).color, getComputedStyle(word.nextElementSibling as Element).color],
          };
        });
      const capture = async (state: string) => {
        const rect = await page.locator('[data-hero-role]').boundingBox();
        assert.ok(rect);
        const x = Math.max(0, rect.x - 10);
        const y = Math.max(0, rect.y - 10);
        await page.screenshot({
          path: `${output}/${lang}-${width}-${state}.png`,
          clip: { x, y, width: Math.min(width, rect.x + rect.width + 10) - x, height: rect.height + 20 },
        });
      };
      const initial = await style();
      await title.click();
      await page.waitForFunction(() => document.querySelector('[data-role-label]')?.textContent === 'AI Engineer');
      const pointer = await style();
      assert.equal(pointer.outline, 'none');
      assert.equal(pointer.line, 'none');
      assert.deepEqual(pointer.colors, initial.colors);
      await capture('pointer');
      await page.locator('header a[href="/projects"]').focus();
      // Actual keyboard traversal, not just a forced :focus-visible class.
      for (let step = 0; step < 8; step++) {
        await page.keyboard.press('Tab');
        if (await title.evaluate((element: Element) => document.activeElement === element)) break;
      }
      const keyboard = await style();
      await capture('keyboard');
      report.push({ lang, width, initial, pointer, keyboard, errors });
      assert.equal(keyboard.visibleFocus, true);
      assert.equal(keyboard.outline, 'none', 'headline has no full-width rectangular focus outline');
      assert.equal(keyboard.line, 'underline', 'keyboard focus still has a visible text-level cue');
      assert.equal(keyboard.wordLine, 'underline', 'the cue follows the complete title, including the inline-block role word');
      assert.equal(keyboard.thickness, '1px');
      assert.ok(Number.parseFloat(keyboard.offset) > 0);
      assert.deepEqual(keyboard.colors, initial.colors, 'focus does not recolor the title');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('[data-role-label]')?.textContent === 'Software Engineer');
      await page.keyboard.press('Space');
      await page.waitForFunction(() => document.querySelector('[data-role-label]')?.textContent === 'AI Engineer');
      for (const selector of ['header a[href="/resume"]', '[data-terminal-fullscreen]']) {
        const control = page.locator(selector);
        await control.focus();
        assert.deepEqual(
          await control.evaluate((element: Element) => ({
            visible: element.matches(':focus-visible'),
            style: getComputedStyle(element).outlineStyle,
            width: getComputedStyle(element).outlineWidth,
            color: getComputedStyle(element).outlineColor,
          })),
          { visible: true, style: 'solid', width: '2px', color: 'rgb(0, 255, 65)' },
        );
      }
      assert.equal(aiRequests, 0);
      assert.deepEqual(errors, []);
      console.log(`PASS headline pointer/keyboard focus, switching, preserved other focus rings ${lang} ${width}`);
      await page.close();
    }
    await context.close();
  }
} finally {
  await Bun.write(`${output}/report.json`, JSON.stringify({ cases: report, aiRequests }, null, 2));
  await browser.close();
}
