// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs SITE_URL=http://localhost:8625 bun apps/site/tests/hero.browser.ts
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.SITE_URL || 'http://localhost:8625';
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/page-transitions';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  ignoreDefaultArgs: ['--disable-back-forward-cache'],
});
const report: unknown[] = [];

type HeroEvidence = {
  timers: Set<number>;
  frames: Set<number>;
  words: string[];
  labels: string[];
  restored: boolean;
};
declare global {
  interface Window {
    heroEvidence: HeroEvidence;
  }
}

function observeHero() {
  const evidence: HeroEvidence = { timers: new Set(), frames: new Set(), words: [], labels: [], restored: false };
  window.heroEvidence = evidence;
  // Observe actual browser scheduling, preserving the real clock and callbacks.
  const set = window.setTimeout.bind(window);
  const clear = window.clearTimeout.bind(window);
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (typeof callback !== 'function' || !new Error().stack?.includes('/hero-role.js')) return set(callback, delay, ...args);
    const id = set(() => {
      evidence.timers.delete(id);
      callback(...args);
    }, delay);
    evidence.timers.add(id);
    return id;
  }) as typeof window.setTimeout;
  window.clearTimeout = (id) => {
    if (typeof id === 'number') evidence.timers.delete(id);
    // Bun's runner types also expose non-browser timer handles. Forward the
    // original argument unchanged; only numeric browser IDs are tracked here.
    Reflect.apply(clear, window, [id]);
  };
  window.requestAnimationFrame = (callback) => {
    const tracked = Boolean(new Error().stack?.includes('/hero-role.js'));
    const id = request((time) => {
      evidence.frames.delete(id);
      callback(time);
    });
    if (tracked) evidence.frames.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    evidence.frames.delete(id);
    cancel(id);
  };
  window.addEventListener('DOMContentLoaded', () => {
    const word = document.querySelector('[data-role-word]');
    const label = document.querySelector('[data-role-label]');
    if (word) new MutationObserver(() => evidence.words.push(word.textContent ?? '')).observe(word, { childList: true });
    if (label) new MutationObserver(() => evidence.labels.push(label.textContent ?? '')).observe(label, { childList: true });
  });
  window.addEventListener('pageshow', (event) => {
    evidence.restored = event.persisted;
  });
  window.addEventListener('pagehide', () => {
    queueMicrotask(() =>
      sessionStorage.setItem('hero-pagehide', JSON.stringify({ timers: evidence.timers.size, frames: evidence.frames.size })),
    );
  });
}

try {
  for (const lang of ['en', 'ru']) {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
      await context.addCookies([{ name: 'lang', value: lang, url: baseURL }]);
      await context.addInitScript(observeHero);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error: Error) => errors.push(error.message));
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => window.heroEvidence.timers.size === 1);
      const boxes = () =>
        page.evaluate(() =>
          ['h1', '[data-hero-role]', 'main p'].map((selector) => {
            const { x, y, width, height } = document.querySelector(selector)?.getBoundingClientRect() as DOMRect;
            return { x, y, width, height };
          }),
        );
      const before = await boxes();
      await page.screenshot({ path: `${output}/hero-${lang}-${width}-software.png` });
      await page.locator('[data-role-switch]').click();
      await page.waitForFunction(() => /[<>/_[\]{}01]/.test(document.querySelector('[data-role-word]')?.textContent ?? ''));
      assert.equal(
        await page.getByRole('heading', { name: 'Software Engineer', exact: true }).count(),
        1,
        'scramble frames never enter the accessible heading',
      );
      // Real-time intermediate frame, not a screenshot of mocked text.
      await page.screenshot({ path: `${output}/hero-${lang}-${width}-scramble.png` });
      await page.waitForFunction(() => document.querySelector('[data-role-label]')?.textContent === 'AI Engineer');
      assert.equal(await page.locator('[data-role-word]').textContent(), 'AI');
      assert.deepEqual(await boxes(), before, 'outer heading and following content do not move');
      await page.screenshot({ path: `${output}/hero-${lang}-${width}-ai.png` });
      await page.locator('[data-role-switch]').focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('[data-role-label]')?.textContent === 'Software Engineer');
      await page.keyboard.press('Space');
      await page.waitForFunction(() => document.querySelector('[data-role-label]')?.textContent === 'AI Engineer');
      // Last requested target wins, even if three requests interrupt one another.
      await page.locator('[data-role-switch]').evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
        button.click();
      });
      await page.waitForFunction(() => document.querySelector('[data-role-label]')?.textContent === 'Software Engineer');
      await page.locator('[data-role-switch]').focus();
      await page.keyboard.press('Escape');
      assert.ok(
        (await page.locator('#role-hint').textContent()).includes(
          lang === 'en' ? 'Automatic changes paused' : 'Автоматическая смена остановлена',
        ),
      );
      await page.locator('[data-role-switch]').evaluate((button: HTMLButtonElement) => button.blur());
      await page.mouse.move(0, 0);
      assert.deepEqual(await page.evaluate(() => ({ timers: window.heroEvidence.timers.size, frames: window.heroEvidence.frames.size })), {
        timers: 0,
        frames: 0,
      });
      await page.waitForTimeout(5100);
      assert.equal(await page.locator('[data-role-word]').textContent(), 'Software', 'pause persists past the autoplay deadline');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('[data-hero-role] [aria-live]').count(), 0);
      assert.equal(await page.locator('[data-role-controls], [data-role-pause]').count(), 0);
      assert.equal(await page.locator('[data-hero-role] button').count(), 1);
      assert.equal(await page.locator('#role-hint').isVisible(), false);
      const evidence = await page.evaluate(() => ({ words: window.heroEvidence.words, labels: window.heroEvidence.labels }));
      assert.ok(evidence.words.some((word: string) => /[<>/_[\]{}01]/.test(word)));
      assert.ok(evidence.labels.every((label: string) => ['Software Engineer', 'AI Engineer'].includes(label)));
      assert.deepEqual(errors, []);
      report.push({ lang, width, before, evidence, errors });
      console.log(`PASS scramble/keyboard/pause/rapid input/stable layout ${lang} ${width}`);
      await context.close();
    }
  }

  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
  await context.addInitScript(observeHero);
  const page = await context.newPage();
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('[data-role-label]')?.textContent === 'AI Engineer', null, { timeout: 7000 });
  await page.locator('[data-role-switch]').hover();
  assert.equal(await page.evaluate(() => window.heroEvidence.timers.size), 0, 'hover suspends autoplay');
  await page.mouse.move(0, 0);
  await page.locator('[data-role-switch]').focus();
  assert.equal(await page.evaluate(() => window.heroEvidence.timers.size), 0, 'focus suspends autoplay');
  await page.keyboard.press('Escape');
  assert.ok((await page.locator('#role-hint').textContent()).includes('Automatic changes paused'));
  await page.keyboard.press('Escape');
  await page.locator('[data-role-switch]').evaluate((button: HTMLButtonElement) => button.blur());
  await page.waitForFunction(() => window.heroEvidence.timers.size === 1);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => window.heroEvidence.timers.size === 0 && window.heroEvidence.frames.size === 0);
  const offscreen = await page.locator('[data-role-word]').textContent();
  await page.waitForTimeout(5100);
  assert.equal(await page.locator('[data-role-word]').textContent(), offscreen);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(() => window.heroEvidence.timers.size === 1);
  // Chromium headless does not expose normal tab visibility reliably. Exercise the
  // event boundary explicitly; real pagehide/BFCache is checked below as well.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.deepEqual(await page.evaluate(() => ({ timers: window.heroEvidence.timers.size, frames: window.heroEvidence.frames.size })), {
    timers: 0,
    frames: 0,
  });
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => window.heroEvidence.timers.size === 1);
  await page.locator('[data-role-switch]').focus();
  await page.keyboard.press('Escape');
  await page.locator('header a[href="/cv"]').click();
  await page.waitForURL('**/cv');
  assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('hero-pagehide') || '{}')), { timers: 0, frames: 0 });
  await page.goBack({ waitUntil: 'commit' });
  await page.waitForURL(`${baseURL}/`, { waitUntil: 'commit' });
  const restored = await page.evaluate(() => window.heroEvidence.restored);
  report.push({ bfcacheRestored: restored, hiddenCheck: 'synthetic visibilitychange' });
  if (restored)
    assert.ok((await page.locator('#role-hint').textContent()).includes('Automatic changes paused'), 'BFCache retains user pause');
  else console.log('LIMITATION: Chromium did not restore BFCache in this run; pageshow/pagehide still tested');
  await page.locator('[data-role-switch]').focus();
  if (restored) await page.keyboard.press('Escape');
  await page.locator('[data-role-switch]').evaluate((button: HTMLButtonElement) => button.blur());
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => window.heroEvidence.timers.size === 1);
  const beforeResume = await page.locator('[data-role-label]').textContent();
  await page.waitForFunction((before: string) => document.querySelector('[data-role-label]')?.textContent !== before, beforeResume, {
    timeout: 7000,
  });
  assert.ok(await page.evaluate(() => window.heroEvidence.timers.size <= 1 && window.heroEvidence.frames.size <= 1));
  console.log(`PASS autoplay/offscreen/hidden/pagehide cleanup/history; BFCache=${restored}`);
  await context.close();

  for (const lang of ['en', 'ru']) {
    const reduced = await browser.newContext({ baseURL, reducedMotion: 'reduce', viewport: { width: 320, height: 800 } });
    await reduced.addCookies([{ name: 'lang', value: lang, url: baseURL }]);
    await reduced.addInitScript(observeHero);
    const page = await reduced.newPage();
    await page.goto('/');
    await page.waitForTimeout(5100);
    assert.equal(await page.locator('[data-role-word]').textContent(), 'Software');
    assert.ok((await page.locator('#role-hint').textContent()).includes(lang === 'en' ? 'reduced motion' : 'уменьшения движения'));
    await page.locator('[data-role-switch]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('heading', { name: 'AI Engineer', exact: true }).count(), 1);
    assert.deepEqual(await page.evaluate(() => ({ timers: window.heroEvidence.timers.size, frames: window.heroEvidence.frames.size })), {
      timers: 0,
      frames: 0,
    });
    assert.ok((await page.evaluate(() => window.heroEvidence.words)).every((word: string) => ['Software', 'AI'].includes(word)));
    await page.screenshot({ path: `${output}/hero-${lang}-reduced.png` });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('[data-role-switch]').evaluate((button: HTMLButtonElement) => button.blur());
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => window.heroEvidence.timers.size === 1);
    await page.locator('[data-role-switch]').click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => window.heroEvidence.frames.size === 0 && window.heroEvidence.timers.size === 0);
    assert.equal(await page.locator('[data-role-word]').textContent(), 'Software');
    console.log(`PASS reduced motion: no autoplay/frames, instant keyboard switch, live preference change ${lang}`);
    await reduced.close();

    const noJS = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 320, height: 800 } });
    await noJS.addCookies([{ name: 'lang', value: lang, url: baseURL }]);
    const staticPage = await noJS.newPage();
    await staticPage.goto('/');
    assert.ok((await staticPage.locator('h1').textContent()).includes('Software'));
    assert.equal(await staticPage.locator('[data-role-switch]').isDisabled(), true);
    assert.equal(await staticPage.locator('[data-role-label]').evaluate((label: Element) => getComputedStyle(label).position), 'absolute');
    assert.equal(await staticPage.locator('[data-role-controls]').count(), 0);
    await staticPage.screenshot({ path: `${output}/hero-${lang}-no-js.png` });
    await staticPage.locator('header a[href="/cv"]').click();
    await staticPage.waitForURL('**/cv');
    console.log(`PASS static no-JS heading/navigation ${lang}`);
    await noJS.close();
  }
} finally {
  await Bun.write(`${output}/hero-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
