// SITE_URL=http://localhost:8614 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs bun apps/site/tests/return-home.browser.ts
// A real logo click, not history.back(). CDP aborts all AI calls without disabling HTTP cache.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.SITE_URL || 'http://localhost:8614';
const homeURL = new URL('/', baseURL).href;
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/return-home/after';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
type Bounds = { x: number; y: number; width: number; height: number };
type Source = { bounds: Bounds; name: string; scroll: number; viewport: { width: number; height: number } };
type Sample = { at: number; scale: number; dx: number; dy: number; opacity: number; group: Bounds; oldWidth: number };
type HomeFrame = {
  at: number;
  hero: Bounds | null;
  main: Bounds | null;
  header: Bounds | null;
  word: string | null;
  enabled: boolean;
  styles: number;
  fonts: { family: string; weight: string; status: string }[];
};
type Evidence = {
  events: { name: string; at: number }[];
  samples: Sample[];
  frames: HomeFrame[];
  native: boolean;
  finished: boolean;
  animations: { name: string; duration: number | string }[];
};
declare global {
  interface Window {
    returnHomeEvidence: Evidence;
  }
}

function observeReturn() {
  const evidence: Evidence = { events: [], samples: [], frames: [], native: false, finished: false, animations: [] };
  window.returnHomeEvidence = evidence;
  const event = (name: string) => evidence.events.push({ name, at: performance.now() });
  const bounds = (selector: string): Bounds | null => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  };
  let firstPaintedFrame = 0;
  function frame(at: number) {
    if (document.querySelector('main')) {
      firstPaintedFrame ||= at;
      evidence.frames.push({
        at,
        hero: bounds('[data-hero-role]'),
        main: bounds('main'),
        header: bounds('header'),
        word: document.querySelector('[data-role-word]')?.textContent ?? null,
        enabled: !document.querySelector<HTMLButtonElement>('[data-role-switch]')?.disabled,
        styles: document.styleSheets.length,
        fonts: [...document.fonts].map((font) => ({ family: font.family, weight: font.weight, status: font.status })),
      });
    }
    if (!firstPaintedFrame || at - firstPaintedFrame < 1000) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.addEventListener('DOMContentLoaded', () => event('DOMContentLoaded'));
  document.fonts.addEventListener('loadingdone', () => event('fonts-loaded'));
  addEventListener('pageshow', () => event('pageshow'));
  addEventListener('pagereveal', (eventObject) => {
    const transition = (eventObject as Event & { viewTransition: ViewTransition | null }).viewTransition;
    evidence.native = Boolean(transition);
    event(`pagereveal:${evidence.native}`);
    if (!transition) {
      evidence.finished = true;
      return;
    }
    transition.ready
      .then(() => {
        event('transition-ready');
        const stored = sessionStorage.getItem('return-home-source');
        if (!stored) return;
        const source = JSON.parse(stored) as Source;
        evidence.animations = document
          .getAnimations()
          .filter((animation) => animation instanceof CSSAnimation)
          .map((animation) => ({
            name: (animation as CSSAnimation).animationName,
            duration: Number(animation.effect?.getTiming().duration ?? 0),
          }));
        function sample() {
          const group = getComputedStyle(document.documentElement, `::view-transition-group(${source.name})`);
          const old = getComputedStyle(document.documentElement, `::view-transition-old(${source.name})`);
          const position = new DOMMatrix(group.transform === 'none' ? undefined : group.transform);
          const movement = new DOMMatrix(old.transform === 'none' ? undefined : old.transform);
          if (Number(old.opacity) > 0 && group.width !== 'auto') {
            evidence.samples.push({
              at: performance.now(),
              scale: Number.parseFloat(old.width) / source.bounds.width,
              dx: position.e + movement.e - source.bounds.x,
              dy: position.f + movement.f - source.bounds.y,
              opacity: Number(old.opacity),
              group: { x: position.e, y: position.f, width: Number.parseFloat(group.width), height: Number.parseFloat(group.height) },
              oldWidth: Number.parseFloat(old.width),
            });
          }
          if (!evidence.finished) requestAnimationFrame(sample);
        }
        sample();
      })
      .catch(() => event('transition-skipped'));
    transition.finished.then(() => {
      evidence.finished = true;
      event('transition-finished');
    });
  });
}

const results: unknown[] = [];
const contexts = new Map();
let aiRequests = 0;
try {
  const configurations = ['en', 'ru'].flatMap((lang) =>
    [1440, 390].flatMap((width) =>
      ['/resume', '/logs', '/projects'].flatMap((route) => [false, true].map((reduced) => ({ lang, width, route, reduced, cold: false }))),
    ),
  );
  configurations.push({ lang: 'en', width: 1440, route: '/resume', reduced: false, cold: true });
  const cases = process.env.RETURN_HOME_SINGLE ? configurations.slice(0, 1) : configurations;
  for (const config of cases) {
    const name = `${config.route.slice(1)}-${config.lang}-${config.width}-${config.reduced ? 'reduced' : 'motion'}-${config.cold ? 'cold' : 'warm'}`;
    const folder = `${output}/${name}`;
    await mkdir(folder, { recursive: true });
    const contextKey = `${config.lang}-${config.width}-${config.reduced}-${config.cold}`;
    let context = contexts.get(contextKey);
    if (!context) {
      context = await browser.newContext({
        baseURL,
        viewport: { width: config.width, height: 900 },
        reducedMotion: config.reduced ? 'reduce' : 'no-preference',
      });
      await context.addCookies([{ name: 'lang', value: config.lang, url: baseURL }]);
      await context.addInitScript(observeReturn);
      contexts.set(contextKey, context);
    }
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error: Error) => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: config.cold });
    // Direct Fetch interception avoids Playwright routing's automatic cache disable.
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/ask*' }, { urlPattern: '*/api/projects' }] });
    cdp.on('Fetch.requestPaused', async (request: { requestId: string; request: { url: string } }) => {
      if (new URL(request.request.url).pathname === '/api/ask') {
        aiRequests++;
        await cdp.send('Fetch.failRequest', { requestId: request.requestId, errorReason: 'BlockedByClient' });
      } else {
        await cdp.send('Fetch.fulfillRequest', {
          requestId: request.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
          body: Buffer.from('<p>Empty public project fixture.</p>').toString('base64'),
        });
      }
    });
    const cached = new Set<string>();
    const resources: { id: string; url: string; cached: boolean }[] = [];
    cdp.on('Network.requestServedFromCache', (event: { requestId: string }) => cached.add(event.requestId));
    cdp.on('Network.responseReceived', (event: { requestId: string; response: { url: string; fromDiskCache?: boolean } }) =>
      resources.push({ id: event.requestId, url: event.response.url, cached: Boolean(event.response.fromDiskCache) }),
    );
    await page.goto(config.route, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => scrollTo(0, 600));
    await page.waitForTimeout(100);
    const source = await page.evaluate((): Source => {
      const element = [document.documentElement, document.querySelector('main')].find(
        (node) => node && getComputedStyle(node).viewTransitionName !== 'none',
      );
      const name = element ? getComputedStyle(element).viewTransitionName : 'none';
      const { x, y, width, height } =
        !element || element === document.documentElement
          ? { x: 0, y: 0, width: innerWidth, height: innerHeight }
          : element.getBoundingClientRect();
      const source = { name, bounds: { x, y, width, height }, scroll: scrollY, viewport: { width: innerWidth, height: innerHeight } };
      sessionStorage.setItem('return-home-source', JSON.stringify(source));
      return source;
    });
    await page.screenshot({ path: `${folder}/source.png` });
    const captured: { data: string; timestamp: number }[] = [];
    cdp.on('Page.screencastFrame', (event: { sessionId: number; data: string; metadata: { timestamp: number } }) => {
      captured.push({ data: event.data, timestamp: event.metadata.timestamp });
      void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    });
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    await page.locator('header a[href="/"]').click();
    try {
      await page.waitForURL(homeURL, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      await Bun.write(
        `${folder}/navigation-failure.json`,
        JSON.stringify(
          {
            expected: homeURL,
            actual: page.url(),
            errors,
            resources,
            document: await page.evaluate(() => ({
              url: location.href,
              ready: document.readyState,
              main: document.querySelectorAll('main').length,
              events: window.returnHomeEvidence?.events,
            })),
          },
          null,
          2,
        ),
      );
      throw error;
    }
    await page.waitForFunction(() => window.returnHomeEvidence.finished);
    await page.waitForTimeout(1050);
    await cdp.send('Page.stopScreencast');
    const evidence = await page.evaluate(() => window.returnHomeEvidence);
    const screenshots = [];
    for (const [index, frame] of captured.entries()) {
      const path = `${folder}/frame-${String(index).padStart(3, '0')}.png`;
      await Bun.write(path, Buffer.from(frame.data, 'base64'));
      screenshots.push({ path, timestamp: frame.timestamp });
    }
    await page.screenshot({ path: `${folder}/final.png` });
    const result = {
      config,
      source,
      evidence,
      screenshots,
      resources: resources.map((resource) => ({ url: resource.url, cached: resource.cached || cached.has(resource.id) })),
      errors,
    };
    await Bun.write(`${folder}/metrics.json`, JSON.stringify(result, null, 2));
    results.push(result);
    assert.equal(evidence.native, !config.reduced);
    assert.deepEqual(errors, []);
    if (!config.reduced) {
      assert.ok(evidence.samples.length > 0, 'measure actual visible outgoing snapshot frames');
      for (const frame of evidence.samples) {
        assert.ok(Math.abs(frame.scale - 1) < 0.001, `${name}: outgoing snapshot resized by ${frame.scale.toFixed(3)}x`);
        assert.ok(Math.abs(frame.dx) <= 1, `${name}: outgoing snapshot jumps horizontally by ${frame.dx}px`);
        assert.ok(Math.abs(frame.dy) <= 2.1, `${name}: outgoing snapshot jumps vertically by ${frame.dy}px beyond the approved 2px exit`);
      }
      assert.deepEqual(
        evidence.animations
          .filter((animation: { name: string }) => animation.name.startsWith('page-'))
          .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)),
        [
          { name: 'page-in', duration: 160 },
          { name: 'page-out', duration: 120 },
        ],
      );
      assert.ok(
        evidence.animations.every((animation: { name: string }) => animation.name.startsWith('page-')),
        'no extra chrome/group morph animation',
      );
    }
    const reveal = evidence.events.find((event: { name: string }) => event.name.startsWith('pagereveal:'))?.at ?? 0;
    const visibleHeroFrames = evidence.frames.filter((frame: HomeFrame) => frame.at >= reveal && frame.hero);
    const reference = visibleHeroFrames.at(-1)?.hero;
    assert.ok(reference, 'home hero was rendered');
    for (const frame of visibleHeroFrames) {
      assert.equal(frame.word, 'Software', 'no premature hero scramble during page entry');
      for (const key of ['x', 'y', 'width', 'height'] as const)
        assert.ok(Math.abs(frame.hero[key] - reference[key]) <= 1, `${name}: home hero ${key} changed during entry`);
    }
    assert.equal(await page.locator('html').getAttribute('lang'), config.lang);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#terminal-input').isVisible(), true);
    assert.equal(await page.locator('#terminal-loader').isVisible(), false);
    assert.equal(aiRequests, 0, 'no AI request made');
    console.log(`PASS ${name}: no snapshot zoom/jump; hero entry stable; ${captured.length} captured frames`);
    await page.close();
  }
} finally {
  await Bun.write(`${output}/report.json`, JSON.stringify({ results, aiRequests }, null, 2));
  await browser.close();
}
