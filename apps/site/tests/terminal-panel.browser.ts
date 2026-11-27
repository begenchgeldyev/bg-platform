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
    fullscreen: page.locator('[data-terminal-fullscreen]'),
    input: page.locator('#terminal-input'),
  };
}

function hasFocus(element: Element) {
  return element === document.activeElement;
}

try {
  const motion = await openResume({ reducedMotion: 'no-preference' });
  await motion.page.goto('/resume');
  const opening = await motion.panel.evaluate(async (element: HTMLElement) => {
    document.querySelector<HTMLButtonElement>('[data-terminal-launcher]')?.click();
    const transitions = element.getAnimations().filter((animation): animation is CSSTransition => animation instanceof CSSTransition);
    const slide = transitions.find((animation) => animation.transitionProperty === 'transform');
    const fade = transitions.find((animation) => animation.transitionProperty === 'opacity');
    if (!slide?.effect || !fade?.effect) return null;
    slide.pause();
    fade.pause();
    await Promise.all([slide.ready, fade.ready]);
    slide.currentTime = 90;
    fade.currentTime = 75;
    const rect = element.getBoundingClientRect();
    const sample = {
      duration: slide.effect.getTiming().duration,
      fadeDuration: fade.effect.getTiming().duration,
      opacity: Number(getComputedStyle(element).opacity),
      slidingUp: rect.top < innerHeight && rect.bottom > innerHeight,
      focused: document.activeElement?.id === 'terminal-input',
    };
    for (const transition of transitions) transition.finish();
    return sample;
  });
  assert.ok(opening, 'opening has a real slide and fade');
  assert.equal(opening.duration, 180);
  assert.equal(opening.fadeDuration, 150);
  assert.ok(opening.opacity > 0.65 && opening.opacity < 1);
  assert.equal(opening.slidingUp, true);
  assert.equal(opening.focused, true);
  await motion.input.fill('help');
  await motion.input.press('Enter');
  await motion.input.fill('cat phi');
  const closing = await motion.panel.evaluate(async (element: HTMLElement) => {
    const launcher = document.querySelector<HTMLButtonElement>('[data-terminal-launcher]');
    element.querySelector<HTMLButtonElement>('[data-terminal-close]')?.click();
    const slide = element
      .getAnimations()
      .find((animation) => animation instanceof CSSTransition && animation.transitionProperty === 'transform');
    if (!slide) return null;
    slide.pause();
    await slide.ready;
    slide.currentTime = 90;
    const rect = element.getBoundingClientRect();
    const sample = {
      slidingDown: rect.top < innerHeight && rect.bottom > innerHeight,
      inert: element.inert,
      focusReturned: document.activeElement === launcher,
      expanded: launcher?.getAttribute('aria-expanded'),
      reserveRemoved: !document.body.hasAttribute('data-terminal-panel-open'),
    };
    launcher?.click();
    return sample;
  });
  assert.deepEqual(closing, { slidingDown: true, inert: true, focusReturned: true, expanded: 'false', reserveRemoved: true });
  assert.equal(await motion.launcher.getAttribute('aria-expanded'), 'true');
  assert.equal(await motion.input.inputValue(), 'cat phi');
  assert.equal(await motion.panel.locator('[data-user-message]').count(), 1);
  await motion.close.click();
  await motion.panel.waitFor({ state: 'hidden' });
  await motion.context.close();
  console.log('PASS Terminal dock animates both ways and preserves state when reopening mid-close');

  const reduced = await openResume({ reducedMotion: 'reduce' });
  await reduced.page.goto('/resume');
  await reduced.launcher.click();
  assert.equal(await reduced.panel.isVisible(), true);
  assert.equal(await reduced.input.evaluate(hasFocus), true);
  assert.equal(await reduced.panel.evaluate((element: Element) => element.getAnimations().length), 0);
  await reduced.close.click();
  assert.equal(await reduced.panel.isVisible(), false);
  assert.equal(await reduced.launcher.evaluate(hasFocus), true);
  assert.equal(await reduced.panel.evaluate((element: Element) => element.getAnimations().length), 0);
  await reduced.context.close();
  console.log('PASS Terminal dock opens and closes immediately under reduced motion');

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
  assert.equal(await launcher.evaluate(hasFocus), true);
  await panel.waitFor({ state: 'hidden' });

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
  await panel.waitFor({ state: 'hidden' });
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
  await touch.page.waitForFunction(
    () => Math.abs((document.querySelector('[data-terminal-panel]')?.getBoundingClientRect().bottom ?? 0) - innerHeight) <= 1,
  );
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
  await touch.panel.waitFor({ state: 'hidden' });
  await touch.context.close();
  console.log('PASS localized touch launcher and accessible page end above the dock');

  const noScript = await openResume({ javaScriptEnabled: false });
  await noScript.page.goto('/resume');
  assert.equal(await noScript.launcher.isVisible(), false);
  assert.equal(await noScript.panel.isVisible(), false);
  assert.equal(await noScript.page.getByRole('heading', { level: 1 }).isVisible(), true);
  await noScript.context.close();

  const native = await openResume();
  await native.page.goto('/resume');
  await native.launcher.click();
  await native.input.fill('cat phi');
  assert.equal(await native.fullscreen.count(), 1, 'the dock offers the existing fullscreen control');
  await native.fullscreen.click();
  await native.page.waitForFunction(() => document.fullscreenElement?.id === 'terminal-wrap');
  assert.equal(await native.panel.evaluate((element: Element) => element.getAnimations().length), 0);
  assert.equal(await native.fullscreen.getAttribute('aria-pressed'), 'true');
  assert.equal(await native.fullscreen.locator('[data-expand-icon]').isVisible(), false);
  assert.equal(await native.fullscreen.locator('[data-restore-icon]').isVisible(), true);
  assert.equal(await native.input.evaluate(hasFocus), true);
  await native.page.keyboard.press('Escape');
  await native.page.waitForFunction(() => !document.fullscreenElement);
  assert.equal(await native.launcher.getAttribute('aria-expanded'), 'true');
  assert.equal(await native.input.inputValue(), 'cat phi');
  await native.fullscreen.press('Enter');
  await native.page.waitForFunction(() => document.fullscreenElement?.id === 'terminal-wrap');
  await native.page.getByRole('button', { name: 'Restore terminal' }).click();
  await native.page.waitForFunction(() => !document.fullscreenElement);
  assert.equal(await native.panel.isVisible(), true);
  await native.fullscreen.click();
  await native.page.waitForFunction(() => document.fullscreenElement?.id === 'terminal-wrap');
  await native.close.click();
  await native.panel.waitFor({ state: 'hidden' });
  assert.equal(await native.page.evaluate(() => document.fullscreenElement), null);
  assert.equal(await native.launcher.getAttribute('aria-expanded'), 'false');
  assert.equal(await native.launcher.evaluate(hasFocus), true);
  await native.context.close();
  console.log('PASS native Terminal fullscreen, restore, Escape and close with focus return');

  for (const mode of ['unsupported', 'denied']) {
    const fallback = await openResume({}, 'ru');
    await fallback.context.addInitScript((kind: string) => {
      if (kind === 'unsupported') Object.defineProperty(document, 'fullscreenEnabled', { value: false });
      else Element.prototype.requestFullscreen = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
    }, mode);
    await fallback.page.goto('/resume');
    await fallback.launcher.click();
    await fallback.fullscreen.click();
    await fallback.page.waitForSelector('[data-terminal-panel][data-terminal-viewport]');
    assert.equal(await fallback.panel.evaluate((element: Element) => element.getAnimations().length), 0);
    assert.equal(await fallback.fullscreen.getAttribute('aria-pressed'), 'true');
    assert.equal(await fallback.fullscreen.locator('[data-expand-icon]').isVisible(), false);
    assert.equal(await fallback.fullscreen.locator('[data-restore-icon]').isVisible(), true);
    assert.equal(await fallback.fullscreen.getAttribute('aria-label'), 'Свернуть терминал');
    assert.equal(await fallback.page.evaluate(() => document.fullscreenElement), null);
    assert.equal(
      await fallback.panel.evaluate((element: Element) => {
        const rect = element.getBoundingClientRect();
        return rect.left === 0 && rect.top === 0 && rect.width === innerWidth && rect.height === innerHeight;
      }),
      true,
    );
    await fallback.page.keyboard.press('Escape');
    assert.equal(await fallback.panel.getAttribute('data-terminal-viewport'), null);
    assert.equal(await fallback.launcher.getAttribute('aria-expanded'), 'true');
    await fallback.fullscreen.click();
    await fallback.page.waitForSelector('[data-terminal-panel][data-terminal-viewport]');
    await fallback.page.getByRole('button', { name: 'Свернуть терминал' }).click();
    assert.equal(await fallback.panel.getAttribute('data-terminal-viewport'), null);
    assert.equal(await fallback.panel.isVisible(), true);
    await fallback.fullscreen.click();
    await fallback.page.waitForSelector('[data-terminal-panel][data-terminal-viewport]');
    await fallback.close.click();
    await fallback.panel.waitFor({ state: 'hidden' });
    assert.equal(await fallback.launcher.evaluate(hasFocus), true);
    await fallback.context.close();
    console.log(`PASS viewport fallback and localized controls when native fullscreen is ${mode}`);
  }

  const pending = await openResume();
  await pending.context.addInitScript(() => {
    Element.prototype.requestFullscreen = () =>
      new Promise((_resolve, reject) => {
        document.addEventListener('reject-test-fullscreen', () => reject(new DOMException('Denied', 'NotAllowedError')), { once: true });
      });
  });
  await pending.page.goto('/resume');
  await pending.launcher.click();
  await pending.fullscreen.click();
  await pending.close.click();
  await pending.page.evaluate(() => document.dispatchEvent(new Event('reject-test-fullscreen')));
  await pending.panel.waitFor({ state: 'hidden' });
  assert.equal(await pending.panel.getAttribute('data-terminal-viewport'), null);
  assert.equal(await pending.launcher.evaluate(hasFocus), true);
  await pending.launcher.click();
  assert.equal(await pending.panel.isVisible(), true);
  assert.equal(await pending.panel.getAttribute('data-terminal-viewport'), null);
  await pending.context.close();
  console.log('PASS closing during a pending fullscreen request prevents a late fallback');

  assert.deepEqual(errors, []);
  assert.equal(askRequests, 0);
} finally {
  await browser.close();
}
