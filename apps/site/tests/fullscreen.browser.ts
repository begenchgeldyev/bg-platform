// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs bun apps/site/tests/fullscreen.browser.ts
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
const baseURL = process.env.SITE_URL || 'http://localhost:8625';
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/page-transitions';
await mkdir(output, { recursive: true });
try {
  for (const lang of ['en', 'ru']) {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600 });
      await context.addCookies([{ name: 'lang', value: lang, url: baseURL }]);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error: Error) => errors.push(error.message));
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const expand = lang === 'en' ? 'Expand terminal' : 'Развернуть терминал';
      const restore = lang === 'en' ? 'Restore terminal' : 'Свернуть терминал';
      const button = page.getByRole('button', { name: expand, exact: true });
      assert.equal(await page.locator('text=zsh — terminal — 80x24').count(), 0);
      assert.equal(await page.locator('[data-terminal-toolbar] button').count(), 1);
      await button.scrollIntoViewIfNeeded();
      const originalScroll = await page.evaluate(() => scrollY);
      if (width < 600) await button.tap();
      else await button.click();
      await page.waitForFunction(() => document.fullscreenElement?.id === 'terminal-wrap');
      assert.equal(await page.locator('#terminal-input').evaluate((input: Element) => document.activeElement === input), true);
      assert.equal(await page.locator('[data-terminal-fullscreen]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-expand-icon]').isVisible(), false);
      assert.equal(await page.locator('[data-restore-icon]').isVisible(), true);
      const dimensions = await page.locator('#terminal-wrap').evaluate((terminal: Element) => {
        const rect = terminal.getBoundingClientRect();
        return { width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
      });
      assert.equal(dimensions.width, dimensions.viewportWidth);
      assert.equal(dimensions.height, dimensions.viewportHeight);
      await page.keyboard.type('cat phi');
      await page.locator('#terminal-input').press('Tab');
      assert.equal(await page.locator('#terminal-input').inputValue(), 'cat philosophy.txt');
      assert.equal(await page.locator('#terminal-display').textContent(), 'cat philosophy.txt');
      // Completion must not trap the keyboard away from the fullscreen control.
      await page.keyboard.press('Shift+Tab');
      assert.equal(
        await page.locator('[data-terminal-fullscreen]').evaluate((control: Element) => document.activeElement === control),
        true,
      );
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('#terminal-input').evaluate((input: Element) => document.activeElement === input), true);
      assert.equal(await page.locator('#terminal-input').inputValue(), 'cat philosophy.txt');
      await page.locator('#terminal-input').press('Enter');
      await page.screenshot({ path: `${output}/fullscreen-${lang}-${width}.png` });
      await page.getByRole('button', { name: restore, exact: true }).click();
      await page.waitForFunction(() => !document.fullscreenElement);
      assert.equal(await button.evaluate((element: Element) => document.activeElement === element), true);
      assert.equal(await page.evaluate(() => scrollY), originalScroll, 'no unexpected scroll on restore');
      assert.equal(await page.locator('[data-terminal-fullscreen]').getAttribute('aria-pressed'), 'false');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.fullscreenElement?.id === 'terminal-wrap');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 3000 });
      assert.equal(await button.evaluate((element: Element) => document.activeElement === element), true);
      assert.equal(await button.getAttribute('title'), expand);
      await page.keyboard.press('Space');
      await page.waitForFunction(() => document.fullscreenElement?.id === 'terminal-wrap');
      await page.getByRole('button', { name: restore, exact: true }).focus();
      await page.keyboard.press('Space');
      await page.waitForFunction(() => !document.fullscreenElement);
      assert.deepEqual(errors, []);
      console.log(`PASS real fullscreen/restore/Escape/Enter/Space/focus/Tab completion/Shift+Tab control access ${lang} ${width}`);
      await context.close();
    }
  }
  const unsupported = await browser.newContext({ baseURL });
  await unsupported.addInitScript(() => Object.defineProperty(document, 'fullscreenEnabled', { value: false }));
  const fallback = await unsupported.newPage();
  await fallback.goto('/', { waitUntil: 'domcontentloaded' });
  assert.equal(await fallback.locator('[data-terminal-toolbar]').isVisible(), false);
  await fallback.locator('#terminal-wrap').click();
  assert.equal(await fallback.locator('#terminal-input').evaluate((input: Element) => document.activeElement === input), true);
  await unsupported.close();
  console.log('PASS unsupported Fullscreen API hides the unavailable control; terminal remains usable');

  const rejected = await browser.newContext({ baseURL });
  await rejected.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
  });
  const denied = await rejected.newPage();
  const errors: string[] = [];
  denied.on('pageerror', (error: Error) => errors.push(error.message));
  await denied.goto('/', { waitUntil: 'domcontentloaded' });
  await denied.locator('[data-terminal-fullscreen]').click();
  await denied.waitForFunction(() => Boolean(document.querySelector('[data-fullscreen-status]')?.textContent));
  assert.equal(await denied.locator('[data-terminal-fullscreen]').getAttribute('aria-pressed'), 'false');
  assert.equal(await denied.locator('[data-terminal-fullscreen]').isEnabled(), true);
  assert.equal(await denied.locator('[data-terminal-fullscreen]').evaluate((button: Element) => document.activeElement === button), true);
  assert.deepEqual(errors, []);
  await rejected.close();
  console.log('PASS rejected fullscreen request is announced without a stuck state or unhandled error');
} finally {
  await browser.close();
}
