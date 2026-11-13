// SITE_URL=http://localhost:8625 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs bun apps/site/tests/motion.browser.ts
// Uses environment-provided Playwright/Chromium; no dependency installation needed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.SITE_URL || 'http://localhost:8625';
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/page-transitions';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const browser = await chromium.launch({ executablePath, headless: true });
const report: unknown[] = [];

type TransitionEvidence = {
  native: boolean;
  ready: boolean;
  finished: boolean;
  animations: { name: string; duration: number | string | CSSNumericValue; delay: number }[];
  samples: { opacity: string; transform: string; canvas: string }[];
};
declare global {
  interface Window {
    transitionEvidence: TransitionEvidence;
  }
}

// Observe the browser's actual cross-document transition, not a JS approximation.
function observeTransitions(freeze: boolean) {
  window.addEventListener('pagereveal', (event) => {
    const transition = (event as Event & { viewTransition: ViewTransition | null }).viewTransition;
    const evidence: TransitionEvidence = { native: Boolean(transition), ready: false, finished: false, animations: [], samples: [] };
    window.transitionEvidence = evidence;
    if (!transition) return;
    transition.ready
      .then(() => {
        const animations = document
          .getAnimations()
          .filter((animation) => animation instanceof CSSAnimation && animation.animationName.startsWith('page-'));
        evidence.animations = animations.map((animation) => ({
          name: (animation as CSSAnimation).animationName,
          duration: animation.effect?.getTiming().duration ?? 0,
          delay: animation.effect?.getTiming().delay ?? 0,
        }));
        if (freeze) {
          for (const animation of animations) {
            animation.pause();
            animation.currentTime = 0;
          }
        }
        evidence.ready = true;
        function sample() {
          const style = getComputedStyle(document.documentElement, '::view-transition-new(page-content)');
          evidence.samples.push({
            opacity: style.opacity,
            transform: style.transform,
            canvas: getComputedStyle(document.documentElement).backgroundColor,
          });
          if (!evidence.finished) requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      })
      .catch(() => {}); // A browser may legitimately skip a transition.
    transition.finished.then(() => {
      evidence.finished = true;
    });
  });
}

try {
  for (const lang of ['en', 'ru']) {
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ baseURL, viewport });
      await context.addCookies([{ name: 'lang', value: lang, url: baseURL }]);
      await context.addInitScript(observeTransitions, false);
      const page = await context.newPage();
      const errors: string[] = [];
      const consoleErrors: { text: string; url: string }[] = [];
      page.on('pageerror', (error: Error) => errors.push(error.message));
      page.on('console', (message: { type: () => string; text: () => string; location: () => { url: string } }) => {
        if (message.type() === 'error') consoleErrors.push({ text: message.text(), url: message.location().url });
      });
      await page.goto('/');
      await page.locator('header a[href="/cv"]').focus();
      await page.keyboard.press('Enter');
      await page.waitForURL('**/cv');
      await page.waitForFunction(() => window.transitionEvidence?.finished);
      const evidence = await page.evaluate(() => window.transitionEvidence);
      assert.equal(evidence.native, true);
      assert.deepEqual(evidence.animations.map((item: { name: string }) => item.name).sort(), ['page-in', 'page-out']);
      assert.ok(evidence.animations.every((item: { duration: number; delay: number }) => item.duration <= 180 && item.delay === 0));
      assert.ok(
        evidence.samples.some((sample: { opacity: string }) => Number(sample.opacity) > 0 && Number(sample.opacity) < 1),
        'actual intermediate opacity',
      );
      assert.ok(
        evidence.samples.some((sample: { transform: string }) => sample.transform !== 'none'),
        'actual slight movement',
      );
      assert.ok(
        evidence.samples.every((sample: { canvas: string }) => sample.canvas === 'rgb(10, 10, 10)'),
        'canvas stays dark',
      );
      assert.deepEqual(
        await page.evaluate(() =>
          [document.documentElement, document.querySelector('header')].map(
            (element) => getComputedStyle(element as Element).viewTransitionName,
          ),
        ),
        ['page-content', 'site-header'],
      );
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.documentElement, '::view-transition-new(site-header)').animationName),
        'none',
        'the separately captured header stays still',
      );
      assert.equal(await page.locator('html').getAttribute('lang'), lang);
      await page.locator('header a[href="/logs"]').click();
      await page.waitForURL('**/logs');
      await page.goBack();
      await page.waitForURL('**/cv');
      await page.goForward();
      await page.waitForURL('**/logs');
      await page.locator('header a[href="/"]').click();
      await page.waitForURL(`${baseURL}/`);
      await page.waitForFunction(() => !window.transitionEvidence?.native || window.transitionEvidence.finished);
      await page.locator('#input-line').click();
      assert.equal(await page.locator('#terminal-input').evaluate((input: Element) => document.activeElement === input), true);
      await page.locator('#terminal-input').fill('help');
      await page.locator('#terminal-input').press('Enter');
      assert.ok((await page.locator('#terminal-body').textContent()).includes('whoami'));
      const other = lang === 'en' ? 'ru' : 'en';
      await page.locator(`[data-lang="${other}"]`).focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction((expected: string) => document.documentElement.lang === expected, other);
      // The new html lang is parsed before blocking head assets and the body.
      await page.locator('h1').waitFor({ state: 'visible' });
      assert.equal(await page.locator('h1').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      report.push({ lang, viewport, evidence, errors, consoleErrors });
      assert.deepEqual(errors, []);
      assert.ok(
        consoleErrors.every((error) => ['/favicon.ico', '/api/logs'].some((path) => error.url.endsWith(path))),
        'no new console errors; existing missing favicon/logs endpoint are recorded',
      );
      console.log(`PASS native navigation/history/language/terminal ${lang} ${viewport.width}`);
      await context.close();

      const frames = await browser.newContext({ baseURL, viewport });
      await frames.addCookies([{ name: 'lang', value: lang, url: baseURL }]);
      await frames.addInitScript(observeTransitions, true);
      const framePage = await frames.newPage();
      await framePage.goto('/');
      await framePage.locator('header a[href="/cv"]').click();
      await framePage.waitForFunction(() => window.transitionEvidence?.ready);
      for (const time of [0, 70, 160]) {
        await framePage.evaluate((time: number) => {
          for (const animation of document.getAnimations()) {
            if (animation instanceof CSSAnimation && animation.animationName.startsWith('page-')) animation.currentTime = time;
          }
        }, time);
        await framePage.screenshot({ path: `${output}/transition-${lang}-${viewport.width}-${time}ms.png` });
      }
      await frames.close();
    }
  }

  const reduced = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
  await reduced.addInitScript(observeTransitions, false);
  const page = await reduced.newPage();
  await page.goto('/');
  await page.locator('header a[href="/cv"]').click();
  await page.waitForURL('**/cv');
  await page.waitForFunction(() => Boolean(window.transitionEvidence));
  assert.equal(await page.evaluate(() => window.transitionEvidence.native), false);
  assert.equal(await page.locator('main').evaluate((main: Element) => getComputedStyle(main).viewTransitionName), 'none');
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.documentElement, '::view-transition-new(page-content)').animationName),
    'none',
  );
  await page.screenshot({ path: `${output}/transition-reduced.png` });
  await reduced.close();
  console.log('PASS reduced-motion opt-out and computed styles');

  const ordinary = await browser.newContext({ baseURL });
  await ordinary.addInitScript(observeTransitions, false);
  const links = await ordinary.newPage();
  // The local server has no DB. Only the project-list API is an explicit boundary fixture.
  await links.route('**/api/projects', (route: { fulfill: (response: object) => Promise<void> }) =>
    route.fulfill({ contentType: 'text/html', body: '<p>No projects in browser fixture.</p>' }),
  );
  await links.goto('/');
  await links.locator('main a[href="/projects"]').click();
  await links.waitForURL('**/projects');
  assert.equal(await links.locator('main').count(), 1);
  await links.goto('/cv');
  const documentId = await links.evaluate(() => {
    document.documentElement.dataset.documentId = 'original';
    return location.href;
  });
  const externalURL = new URL('/logs', baseURL);
  externalURL.hostname = externalURL.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  await links.evaluate(() => {
    const anchor = document.createElement('a');
    anchor.href = '#contact-test';
    anchor.textContent = 'Hash test';
    anchor.id = 'hash-test';
    document.querySelector('main')?.prepend(anchor);
  });
  await links.locator('#hash-test').click();
  assert.equal(await links.locator('html').getAttribute('data-document-id'), 'original');
  assert.equal(links.url(), `${documentId}#contact-test`);
  const popupPromise = ordinary.waitForEvent('page');
  await links.locator('header a[href="/logs"]').click({ modifiers: ['Control'] });
  const popup = await popupPromise;
  await popup.waitForLoadState();
  assert.ok(popup.url().endsWith('/logs'));
  assert.ok(links.url().endsWith('#contact-test'));
  await popup.close();
  // Use native anchors/form to characterize that no global navigation handler intervenes.
  await links.evaluate((externalURL: string) => {
    document
      .querySelector('main')
      ?.insertAdjacentHTML(
        'afterbegin',
        `<a id="download-test" href="/public/fonts/OpenTUIMono-Regular.woff2" download>Download</a><a id="external-test" href="${externalURL}" target="_blank">External origin</a><form id="form-test" action="/logs" method="get"><button>Submit test</button></form>`,
      );
  }, externalURL.href);
  const downloadPromise = links.waitForEvent('download');
  await links.locator('#download-test').click();
  assert.equal((await downloadPromise).suggestedFilename(), 'OpenTUIMono-Regular.woff2');
  const externalPromise = ordinary.waitForEvent('page');
  await links.locator('#external-test').click();
  const external = await externalPromise;
  await external.waitForLoadState();
  assert.equal(new URL(external.url()).hostname, externalURL.hostname);
  assert.equal(await external.evaluate(() => window.transitionEvidence.native), false);
  await external.close();
  await links.locator('#form-test button').click();
  await links.waitForURL('**/logs?');
  await links.goto('/admin');
  assert.equal(await links.locator('main').evaluate((main: Element) => getComputedStyle(main).viewTransitionName), 'none');
  await links.locator('header a[href="/cv"]').click();
  await links.waitForURL('**/cv');
  assert.equal(await links.evaluate(() => window.transitionEvidence.native), false, 'admin does not opt into transitions');
  await ordinary.close();
  console.log('PASS project shell, hashes, modified clicks, download, external origin, form, admin boundary');

  // Modern Chromium removed the old runtime kill switch. Simulate an engine that
  // ignores the unsupported @view-transition rule; do not claim cross-engine coverage.
  const fallbackBrowser = await chromium.launch({ executablePath, headless: true });
  try {
    const fallback = await fallbackBrowser.newContext({ baseURL });
    await fallback.route(
      '**/*',
      async (route: {
        request: () => { resourceType: () => string };
        fetch: () => Promise<{ text: () => Promise<string> }>;
        fulfill: (response: object) => Promise<void>;
        continue: () => Promise<void>;
      }) => {
        if (route.request().resourceType() !== 'document') return route.continue();
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace(/@view-transition\s*\{[^}]*\}/g, '') });
      },
    );
    await fallback.addInitScript(observeTransitions, false);
    const page = await fallback.newPage();
    await page.goto('/');
    await page.locator('header a[href="/cv"]').click();
    await page.waitForURL('**/cv');
    assert.equal(await page.locator('main').count(), 1);
    assert.equal(await page.evaluate(() => window.transitionEvidence.native), false, 'ordinary navigation when native opt-in is ignored');
    await page.screenshot({ path: `${output}/transition-unsupported.png` });
    await page.goBack();
    await page.waitForURL(`${baseURL}/`);
    await page.locator('#input-line').click();
    assert.equal(await page.locator('#terminal-input').evaluate((input: Element) => document.activeElement === input), true);
    console.log('PASS simulated unsupported-rule ordinary navigation/history/terminal fallback');
  } finally {
    await fallbackBrowser.close();
  }
} finally {
  await Bun.write(`${output}/navigation-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
