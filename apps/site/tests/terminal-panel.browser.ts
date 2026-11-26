import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
const baseURL = process.env.SITE_URL || 'http://localhost:8613';
let askRequests = 0;
const errors: string[] = [];

async function openResume(options = {}, lang = 'en') {
  const context = await browser.newContext({ baseURL, ...options });
  await context.addCookies([{ name: 'lang', value: lang, url: baseURL }]);
  await context.route('**/api/ask', (route: { abort(): Promise<void> }) => {
    askRequests++;
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  page.on('pageerror', (error: Error) => errors.push(error.message));
  return {
    context,
    page,
    launcher: page.locator('[data-terminal-launcher]'),
    panel: page.locator('[data-terminal-panel]'),
    close: page.locator('[data-terminal-close]'),
    input: page.locator('#terminal-input'),
  };
}

function hasFocus(element: Element) {
  return element === document.activeElement;
}

try {
  const { context, page, launcher, panel, close, input } = await openResume();
  const response = await page.goto('/resume');
  assert.equal(response?.status(), 200);
  assert.equal(await launcher.count(), 1, 'Resume offers a Terminal launcher');
  assert.equal(await panel.isVisible(), false);
  await launcher.click();
  assert.equal(await launcher.getAttribute('aria-expanded'), 'true');
  assert.equal(await panel.isVisible(), true);
  assert.equal(page.url(), new URL('/resume', baseURL).href);
  assert.equal(await input.evaluate(hasFocus), true);
  await input.fill('help');
  await input.press('Enter');
  await input.fill('cat phi');
  await input.press('Escape');
  assert.equal(await panel.isVisible(), true);
  await input.press('Shift+Tab');
  assert.equal(await close.evaluate(hasFocus), true);
  await page.keyboard.press('Enter');
  assert.equal(await launcher.getAttribute('aria-expanded'), 'false');
  assert.equal(await panel.isVisible(), false);
  assert.equal(await launcher.evaluate(hasFocus), true);

  await page.keyboard.press('Space');
  assert.equal(await panel.isVisible(), true);
  assert.equal(await input.inputValue(), 'cat phi');
  assert.equal(await panel.locator('[data-user-message]').count(), 1);
  assert.match(await panel.innerText(), /show this message/);
  await input.press('Tab');
  assert.equal(await input.inputValue(), 'cat philosophy.txt');
  await input.press('ArrowUp');
  assert.equal(await input.inputValue(), 'help');
  await launcher.press('Enter');
  assert.equal(await panel.isVisible(), false);
  await launcher.click();
  await page.reload();
  assert.equal(await panel.isVisible(), false);
  assert.equal(await input.inputValue(), '');
  assert.equal(await panel.locator('[data-user-message]').count(), 0);
  await context.close();
  console.log('PASS Terminal mouse/keyboard, state retention and reset on reload');

  const touch = await openResume({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true }, 'ru');
  await touch.page.goto('/resume');
  await touch.launcher.tap();
  assert.equal(await touch.launcher.getAttribute('aria-expanded'), 'true');
  assert.equal(await touch.panel.getAttribute('aria-label'), 'Терминал');
  assert.equal(await touch.close.evaluate(hasFocus), true);
  const bounds = await touch.panel.evaluate((element: Element) => {
    scrollTo(0, document.documentElement.scrollHeight);
    const rect = element.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      top: rect.top,
      viewport: innerHeight,
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      footerBottom: document.querySelector('footer')?.getBoundingClientRect().bottom ?? Infinity,
    };
  });
  assert.ok(Math.abs(bounds.bottom - bounds.viewport) <= 1);
  assert.ok(bounds.top > 0 && bounds.footerBottom <= bounds.top + 1);
  assert.ok(bounds.scrollWidth <= bounds.width);
  await touch.close.tap();
  assert.equal(await touch.panel.isVisible(), false);
  await touch.context.close();
  console.log('PASS localized touch launcher and accessible page end above the dock');

  const noScript = await openResume({ javaScriptEnabled: false });
  await noScript.page.goto('/resume');
  assert.equal(await noScript.launcher.isVisible(), false);
  assert.equal(await noScript.panel.isVisible(), false);
  assert.equal(await noScript.page.getByRole('heading', { level: 1 }).isVisible(), true);
  await noScript.context.close();
  assert.deepEqual(errors, []);
  assert.equal(askRequests, 0);
} finally {
  await browser.close();
}
