// SITE_URL=http://localhost:8681 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs bun apps/site/tests/projects-motion.browser.ts
// Animated WebP scenes on the real gallery page and rendered project pages.
// Deterministic repository data goes through the production ProjectController;
// only storage is replaced, never card/detail markup or document policy.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import type { Project } from '@bg/core';
import { ProjectController, type ProjectControllerRepository } from '../project/project.controller';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.SITE_URL || 'http://localhost:8681';
const output = process.env.EVIDENCE_DIR || `${process.cwd()}/.slim/deepwork/codebase-deepening/rendering-artifacts/browser`;
const executablePath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
await mkdir(output, { recursive: true });

const PANTHEON = '/public/projects/pantheon-pixel';
const PLATFORM = '/public/projects/bg-platform-pixel';

const browser = await chromium.launch({ executablePath, headless: true });
const checks: { name: string; passed: boolean; data?: unknown; error?: string }[] = [];
const screenshots: string[] = [];
const failures: string[] = [];
let aiRequests = 0;

function fixtureProject(id: number, name: string, base: string, content: string | null = null): Project {
  return {
    id,
    name,
    description: `${name} fixture description`,
    content,
    image: `${base}.png`,
    isHidden: false,
    icon: 'terminal',
    tags: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function fixtureController(projects: Project[]) {
  const refuseWrite = async (): Promise<never> => {
    throw new Error('Motion fixture forbids writes');
  };
  const repository: ProjectControllerRepository = {
    async list({ includeHidden }) {
      return projects.filter((project) => includeHidden || !project.isHidden);
    },
    async findById(id) {
      return projects.find((project) => project.id === id) ?? null;
    },
    create: refuseWrite,
    updateById: refuseWrite,
    deleteById: refuseWrite,
  };
  return new ProjectController(repository, async () => 'visitor');
}

async function card(id: number, name: string, base: string) {
  const controller = fixtureController([fixtureProject(id, name, base)]);
  const response = await controller.get(new Request(`${baseURL}/api/projects`, { headers: { 'HX-Request': 'true' } }));
  assert.equal(response.status, 200);
  return response.text();
}

async function detailFixture(base: string, content: string) {
  const controller = fixtureController([fixtureProject(4, 'Pantheon', base, content)]);
  const response = await controller.getPageById(new Request(`${baseURL}/projects/4`), 4);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.text();
}

const detailBody = Array.from({ length: 60 }, (_, index) => `<p>Detail fixture line ${index} for a scrollable page.</p>`).join('');

function shot(name: string) {
  screenshots.push(name);
  return `${output}/${name}.png`;
}

async function check(name: string, run: () => Promise<unknown>) {
  try {
    const data = await run();
    checks.push({ name, passed: true, data });
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    checks.push({ name, passed: false, error: message });
    console.log(`FAIL ${name}: ${message}`);
  }
}

type BrowserContext = Awaited<ReturnType<typeof browser.newContext>>;
type BrowserPage = Awaited<ReturnType<typeof browser.newPage>>;
// The optional external Playwright import has no repository-local declarations.
type BrowserRoute = {
  abort(): Promise<void>;
  continue(): Promise<void>;
  fulfill(options: { status?: number; contentType: string; body: string }): Promise<void>;
};

async function openPage(context: BrowserContext) {
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.route('**/api/ask**', (route: BrowserRoute) => {
    aiRequests++;
    return route.abort();
  });
  return page;
}

function motionRequests(page: BrowserPage) {
  const urls: string[] = [];
  page.on('request', (request: { url(): string }) => {
    if (/-motion-\d+\.webp/.test(request.url())) urls.push(request.url());
  });
  return urls;
}

async function probe(page: BrowserPage, kind: 'card' | 'detail') {
  // Do not accept unstyled geometry/motion evidence when generated CSS is missing.
  await page.waitForFunction(() => getComputedStyle(document.body).fontFamily.includes('OpenTUI Mono'));
  return page.evaluate((surface: 'card' | 'detail') => {
    const image = document.querySelector<HTMLImageElement>(surface === 'card' ? '[data-project-cover]' : '[data-project-preview]');
    const frame = surface === 'card' ? image?.closest('.project-cover') : image?.closest('picture')?.parentElement;
    if (!image || !frame) return null;
    const after = getComputedStyle(frame, '::after');
    const before = getComputedStyle(frame, '::before');
    const animations = frame.getAnimations({ subtree: true });
    const scene = frame.querySelector<HTMLImageElement>('[data-project-scene]');
    const rect = frame.getBoundingClientRect();
    return {
      attr: frame.getAttribute('data-image-motion'),
      mode: frame.getAttribute('data-image-motion-mode'),
      afterAnimation: after.animationName,
      afterOpacity: after.opacity,
      afterPosition: after.backgroundPosition,
      beforeOpacity: before.opacity,
      animations: animations.map((animation) => ({
        name: animation instanceof CSSAnimation ? animation.animationName : null,
        playState: animation.playState,
      })),
      running: Boolean(scene?.getAttribute('src') && !scene.hidden && scene.naturalWidth > 0),
      scene: scene ? { src: scene.getAttribute('src'), width: scene.naturalWidth, hidden: scene.hidden } : null,
      overlayNodes: frame.querySelectorAll('[data-image-motion-layer], canvas, svg').length,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      image: {
        src: image.getAttribute('src'),
        currentSrc: image.currentSrc,
        loading: image.loading,
        decoding: image.decoding,
        srcset: image.getAttribute('srcset'),
        naturalWidth: image.naturalWidth,
        visibility: getComputedStyle(image).visibility,
      },
    };
  }, kind);
}

async function waitForAttr(page: BrowserPage, kind: 'card' | 'detail', value: string | null) {
  await page.waitForFunction(
    ({ surface, expected }: { surface: 'card' | 'detail'; expected: string | null }) => {
      const image = document.querySelector<HTMLImageElement>(surface === 'card' ? '[data-project-cover]' : '[data-project-preview]');
      const frame = surface === 'card' ? image?.closest('.project-cover') : image?.closest('picture')?.parentElement;
      if (!frame) return false;
      return expected === null ? !frame.hasAttribute('data-image-motion') : frame.getAttribute('data-image-motion') === expected;
    },
    { surface: kind, expected: value },
  );
}

function assertIdle(state: Awaited<ReturnType<typeof probe>>, expected: string | null) {
  assert.ok(state, 'image frame must exist');
  assert.equal(state.attr, expected, 'frame must hold the documented idle state');
  assert.equal(state.running, false, 'idle frame must have no running animation');
  assert.equal(state.animations.length, 0, 'idle frame must have no animations');
  assert.equal(state.afterAnimation, 'none', 'idle overlay must have no animation');
  assert.equal(state.scene, null, 'idle frame must release its animated image');
  return state;
}

async function galleryRoute(context: BrowserContext, content: string | Promise<string>) {
  const body = await content;
  return context.route('**/api/projects', (route: BrowserRoute) => route.fulfill({ status: 200, contentType: 'text/html', body }));
}

try {
  assert.equal((await fetch(`${baseURL}/public/assets/tailwind.css`)).status, 200, 'build the site CSS before browser verification');
  const detailHtml = await detailFixture(PANTHEON, detailBody);
  const failedDetailHtml = await detailFixture('/public/projects/missing-pixel', detailBody);
  await Bun.write(`${output}/detail-fixture.html`, detailHtml);
  await Bun.write(`${output}/detail-failed-fixture.html`, failedDetailHtml);

  await check('visible desktop cards autoplay only after the existing decode contract', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await openPage(context);
    const requests = motionRequests(page);
    await galleryRoute(context, card(4, 'Pantheon', PANTHEON));
    // Hold only completion of the real static decode, never the motion implementation.
    await page.addInitScript(() => {
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = async function () {
        await decode.call(this);
        if (this.hasAttribute('data-project-cover')) {
          await new Promise<void>((resolve) => {
            (window as Window & { releaseStaticDecode?: () => void }).releaseStaticDecode = resolve;
          });
        }
      };
    });
    try {
      await page.goto('/projects', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.project-card');
      assert.equal(
        await page.evaluate(() => document.querySelectorAll('script[src="/public/projects-motion.js"]').length),
        1,
        'the shared motion enhancement must be included outside the swapped gallery content',
      );
      await page.waitForFunction(() => Boolean((window as Window & { releaseStaticDecode?: () => void }).releaseStaticDecode));
      const idle = assertIdle(await probe(page, 'card'), null);
      assert.equal(requests.length, 0, 'cards must not download animations before static decoding finishes');
      assert.ok(idle.image.currentSrc.endsWith('.avif'), 'the responsive AVIF source must remain in use');
      await page.evaluate(() => (window as Window & { releaseStaticDecode?: () => void }).releaseStaticDecode?.());
      await waitForAttr(page, 'card', 'active');
      const active = await probe(page, 'card');
      assert.ok(active, 'card probe');
      assert.equal(active.attr, 'active');
      assert.equal(active.mode, 'card');
      assert.equal(active.running, true, 'a visible card must run without hover or focus');
      assert.equal(active.afterAnimation, 'none', 'the synthetic sweep must be gone');
      assert.ok(active.scene?.src?.endsWith('-motion-480.webp'), 'autoplay must display the actual animated scene');
      assert.equal(active.overlayNodes, 0, 'motion must not add decorative layers');
      assert.deepEqual(active.rect, idle.rect, 'activation must not move the cover');
      assert.equal(active.image.src, idle.image.src);
      assert.equal(active.image.currentSrc, idle.image.currentSrc);
      assert.equal(active.image.loading, idle.image.loading);
      assert.equal(active.image.decoding, idle.image.decoding);
      const firstFrame = await page.locator('.project-cover').first().screenshot();
      await page.waitForTimeout(520);
      const secondFrame = await page.locator('.project-cover').first().screenshot();
      assert.ok(!firstFrame.equals(secondFrame), 'decoded scene frames must visibly change without CSS animation');
      const later = await probe(page, 'card');
      assert.ok(later, 'card probe');
      assert.equal(later.animations.length, 0, 'scene movement must not come from CSS animations');
      await page.screenshot({ path: shot('gallery-autoplay-1440') });
      await page.locator('.project-card').first().hover();
      await page.mouse.move(4, 4);
      await page.waitForTimeout(180);
      assert.equal((await probe(page, 'card'))?.running, true, 'leaving hover must not stop a visible card');
      assert.equal(requests.length, 1, 'pointer interaction must not restart the scene');
      await Bun.write(`${output}/gallery-autoplay-frames.json`, JSON.stringify({ idle, active, later }, null, 2));
    } finally {
      await context.close();
    }
  });

  await check('keyboard focus remains visible and leaving focus does not stop autoplay', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await openPage(context);
    await galleryRoute(context, card(4, 'Pantheon', PANTHEON));
    try {
      await page.goto('/projects', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.project-card');
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
      await page.locator('.project-card-link').first().focus();
      await waitForAttr(page, 'card', 'active');
      const focused = await probe(page, 'card');
      assert.ok(focused?.running, 'focus must run the authored animation');
      assert.equal(
        await page
          .locator('.project-card-link')
          .first()
          .evaluate((element: Element) => element.matches(':focus-visible')),
        true,
      );
      await page.screenshot({ path: shot('gallery-focus-1440') });
      await page
        .locator('.project-card-link')
        .first()
        .evaluate((element: HTMLElement) => element.blur());
      await page.waitForTimeout(180);
      assert.equal((await probe(page, 'card'))?.running, true, 'leaving focus must not stop a visible card');
    } finally {
      await context.close();
    }
  });

  await check('an untouched card resumes autoplay after a document visibility round-trip', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await openPage(context);
    await galleryRoute(context, card(4, 'Pantheon', PANTHEON));
    try {
      await page.goto('/projects', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.project-card');
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
      await page.evaluate(() => {
        const card = document.querySelector('.project-card');
        const counts = { focusin: 0, pointerenter: 0 };
        card?.addEventListener('focusin', () => counts.focusin++);
        card?.addEventListener('pointerenter', () => counts.pointerenter++);
        (window as Window & { interactionEvents?: typeof counts }).interactionEvents = counts;
      });
      const hide = () =>
        page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          document.dispatchEvent(new Event('visibilitychange'));
        });
      const show = () =>
        page.evaluate(() => {
          Reflect.deleteProperty(document, 'visibilityState');
          document.dispatchEvent(new Event('visibilitychange'));
        });

      await waitForAttr(page, 'card', 'active');
      await hide();
      await waitForAttr(page, 'card', null);
      assertIdle(await probe(page, 'card'), null);
      await show();
      await page.waitForFunction(
        () => document.querySelector('.project-cover')?.getAttribute('data-image-motion') === 'active',
        undefined,
        { timeout: 2500 },
      );
      assert.equal(
        (await page.evaluate(() => (window as Window & { interactionEvents?: { focusin: number } }).interactionEvents?.focusin)) ?? 0,
        0,
        'resumed autoplay must not depend on a focusin event',
      );
      assert.equal(
        await page.evaluate(
          () => (window as Window & { interactionEvents?: { pointerenter: number } }).interactionEvents?.pointerenter ?? 0,
        ),
        0,
        'resumed autoplay must not depend on a pointerenter event',
      );
    } finally {
      await context.close();
    }
  });

  await check('a card crossing 1% visibility activates without waiting for 35%', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await openPage(context);
    await galleryRoute(context, card(4, 'Pantheon', PANTHEON));
    try {
      await page.goto('/projects', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.project-card');
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
      // Test-only spacer: the tall viewport-relative scroll range this check needs, without
      // touching the shipped gallery markup or its layout.
      await page.evaluate(() => {
        const gallery = document.getElementById('project-gallery');
        const spacer = document.createElement('div');
        spacer.id = 'motion-geometry-spacer';
        spacer.style.height = '1200px';
        gallery?.before(spacer);
      });
      const geometry = await page.evaluate(() => {
        const frame = document.querySelector('[data-project-cover]')?.closest('.project-cover');
        if (!frame) return null;
        const rect = frame.getBoundingClientRect();
        return {
          top: rect.top + window.scrollY,
          height: rect.height,
          viewport: window.innerHeight,
          maxScroll: document.documentElement.scrollHeight - window.innerHeight,
        };
      });
      assert.ok(geometry, 'cover geometry');
      assert.ok(geometry.height > 100, 'cover must have a measurable height');
      const justInside = 1;
      const belowMinimumScroll = Math.round(geometry.top - (geometry.viewport - justInside));
      assert.ok(belowMinimumScroll > 0, 'the cover must sit far enough down the page to start partly outside');
      assert.ok(belowMinimumScroll < geometry.maxScroll, 'the page must scroll far enough for a sub-1% intersection');
      await page.evaluate((y: number) => window.scrollTo(0, y), belowMinimumScroll);
      await page.waitForTimeout(180);
      const belowMinimum = await probe(page, 'card');
      assert.equal(belowMinimum?.attr, 'ready', 'a cover under 1% in view must stay idle');

      // Keyboard activation with preventScroll: normal focus would scroll the cover into view.
      await page
        .locator('.project-card-link')
        .first()
        .evaluate((element: HTMLElement) => element.focus({ preventScroll: true }));
      assert.equal(await page.evaluate(() => window.scrollY), belowMinimumScroll, 'focus must not move the cover into view');
      assert.equal((await probe(page, 'card'))?.attr, 'ready', 'focus alone cannot activate a cover below the 1% minimum');
      await page
        .locator('.project-card-link')
        .first()
        .evaluate((element: HTMLElement) => element.blur());

      // Scroll to a ratio between the card minimum (1%) and the page threshold (35%).
      const betweenScroll = belowMinimumScroll + Math.round(geometry.height * 0.1);
      assert.ok(betweenScroll < geometry.maxScroll, 'the page must scroll far enough for a 10% intersection');
      await page.evaluate((y: number) => window.scrollTo(0, y), betweenScroll);
      const ratio = await page.evaluate(() => {
        const frame = document.querySelector('[data-project-cover]')?.closest('.project-cover');
        if (!frame) return 0;
        const rect = frame.getBoundingClientRect();
        const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        return visible > 0 ? visible / rect.height : 0;
      });
      assert.ok(ratio > 0.01 && ratio < 0.35, `expected a 1%-35% intersection, saw ${ratio}`);
      await page.waitForFunction(
        () => document.querySelector('.project-cover')?.getAttribute('data-image-motion') === 'active',
        undefined,
        { timeout: 2500 },
      );
      const active = await probe(page, 'card');
      assert.equal(active?.attr, 'active');
      assert.equal(active?.running, true, 'crossing the 1% minimum must run the authored animation');
      await page.screenshot({ path: shot('gallery-partial-visibility') });
    } finally {
      await context.close();
    }
  });

  await check('reduced motion stays static and follows a live preference change', async () => {
    const reduced = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const reducedPage = await openPage(reduced);
    const requests = motionRequests(reducedPage);
    await galleryRoute(reduced, card(4, 'Pantheon', PANTHEON));
    try {
      await reducedPage.goto('/projects', { waitUntil: 'domcontentloaded' });
      await reducedPage.waitForSelector('.project-card');
      await reducedPage.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
      await reducedPage.locator('.project-card').first().hover();
      await reducedPage.waitForTimeout(260);
      assertIdle(await probe(reducedPage, 'card'), null);
      assert.equal(requests.length, 0);
      await reducedPage.screenshot({ path: shot('gallery-reduced-1440') });
    } finally {
      await reduced.close();
    }

    const live = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await openPage(live);
    await galleryRoute(live, card(4, 'Pantheon', PANTHEON));
    try {
      await page.goto('/projects', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.project-card');
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
      await waitForAttr(page, 'card', 'active');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await waitForAttr(page, 'card', null);
      assertIdle(await probe(page, 'card'), null);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await waitForAttr(page, 'card', 'active');
    } finally {
      await live.close();
    }
  });

  await check('touch-only cards autoplay and keep navigating', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await openPage(context);
    const requests = motionRequests(page);
    await galleryRoute(context, card(4, 'Pantheon', PANTHEON));
    try {
      await page.goto('/projects', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.project-card');
      const media = await page.evaluate(() => ({
        coarse: matchMedia('(pointer: coarse)').matches,
        hover: matchMedia('(hover: hover)').matches,
      }));
      assert.equal(media.coarse, true);
      assert.equal(media.hover, false);
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
      await waitForAttr(page, 'card', 'active');
      assert.equal((await probe(page, 'card'))?.running, true, 'touch cards must autoplay without interaction');
      const firstFrame = await page.locator('.project-cover').first().screenshot();
      await page.waitForTimeout(520);
      const secondFrame = await page.locator('.project-cover').first().screenshot();
      assert.ok(!firstFrame.equals(secondFrame), 'touch autoplay must render changing scene pixels');
      await page.screenshot({ path: shot('gallery-narrow-coarse-390') });
      assert.equal(requests.length, 1, 'touch cards must request their animated WebP');
      await page.locator('.project-card-link').first().tap();
      await page.waitForURL('**/projects/4');
      assert.ok(page.url().includes('/projects/4'), 'the card must remain a working link');
    } finally {
      await context.close();
    }
  });

  await check('a project page animates while visible and stops when scrolled away or hidden', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await openPage(context);
    await context.route('**/projects/4', (route: BrowserRoute) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: detailHtml }),
    );
    try {
      await page.goto('/projects/4', { waitUntil: 'domcontentloaded' });
      assert.equal(
        await page.evaluate(() => document.querySelectorAll('script[src="/public/projects-motion.js"]').length),
        1,
        'the shared enhancement must be included on a project page',
      );
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>('[data-project-preview]');
        return Boolean(image?.complete && image.naturalWidth > 0);
      });
      await waitForAttr(page, 'detail', 'active');
      const active = await probe(page, 'detail');
      assert.ok(active?.running, 'visible project image must run');
      assert.equal(active?.mode, 'page');
      assert.equal(active?.afterAnimation, 'none');
      assert.ok(active?.scene?.src?.endsWith('-motion-960.webp'));
      await page.evaluate(() => document.querySelector('[data-project-preview]')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(420);
      await page.screenshot({ path: shot('detail-active-1440') });
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await waitForAttr(page, 'detail', 'ready');
      const offscreen = await probe(page, 'detail');
      assert.equal(offscreen?.running, false, 'offscreen project image must stop');
      await page.screenshot({ path: shot('detail-offscreen') });
      await page.evaluate(() => scrollTo(0, 0));
      await waitForAttr(page, 'detail', 'active');

      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await waitForAttr(page, 'detail', null);
      assert.equal((await probe(page, 'detail'))?.running, false, 'hidden document must stop the sweep');
      await page.evaluate(() => {
        Reflect.deleteProperty(document, 'visibilityState');
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await waitForAttr(page, 'detail', 'active');
    } finally {
      await context.close();
    }
  });

  await check('reduced motion keeps project pages static', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await openPage(context);
    const requests = motionRequests(page);
    await context.route('**/projects/4', (route: BrowserRoute) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: detailHtml }),
    );
    try {
      await page.goto('/projects/4', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>('[data-project-preview]');
        return Boolean(image?.complete && image.naturalWidth > 0);
      });
      await page.waitForTimeout(300);
      assertIdle(await probe(page, 'detail'), null);
      assert.equal(requests.length, 0);
      await page.screenshot({ path: shot('detail-reduced-1440') });
    } finally {
      await context.close();
    }
  });

  await check('a failed image never receives decoration', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await openPage(context);
    await context.route('**/projects/4', (route: BrowserRoute) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: failedDetailHtml }),
    );
    try {
      await page.goto('/projects/4', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>('[data-project-preview]');
        return Boolean(image?.complete && image.naturalWidth === 0);
      });
      await page.waitForTimeout(220);
      const state = await probe(page, 'detail');
      assert.ok(state, 'detail probe');
      assert.notEqual(state.attr, 'active');
      assert.equal(state.running, false);
      assert.equal(state.animations.length, 0);
      await page.screenshot({ path: shot('detail-failed') });
    } finally {
      await context.close();
    }

    const galleryContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const galleryPage = await openPage(galleryContext);
    await galleryRoute(galleryContext, card(4, 'Pantheon', PANTHEON));
    await galleryContext.route('**/public/projects/*', (route: BrowserRoute) => route.abort());
    try {
      await galleryPage.goto('/projects', { waitUntil: 'domcontentloaded' });
      await galleryPage.waitForSelector('.project-card');
      await galleryPage.waitForFunction(() => document.querySelector<HTMLPictureElement>('.project-cover picture')?.hidden === true);
      await galleryPage.locator('.project-card').first().hover();
      await galleryPage.waitForTimeout(260);
      const state = await probe(galleryPage, 'card');
      assert.ok(state, 'card probe');
      assert.notEqual(state.attr, 'active');
      assert.equal(state.running, false);
      assert.equal(state.animations.length, 0);
      assert.equal(await galleryPage.locator('.project-cover-fallback').first().isVisible(), true);
      await galleryPage.screenshot({ path: shot('gallery-failed-hover') });
    } finally {
      await galleryContext.close();
    }
  });

  await check('repeated HTMX replacement cleans old frames and registers later images once', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await openPage(context);
    const fixture = (await Promise.all([card(4, 'Pantheon', PANTHEON), card(2, 'bg-platform', PLATFORM)])).join('');
    await galleryRoute(context, fixture);
    try {
      await page.goto('/projects', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.project-card');
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
      await waitForAttr(page, 'card', 'active');
      await page.evaluate(() => {
        (window as Window & { oldFrame?: Element }).oldFrame = document.querySelector('.project-cover') ?? undefined;
        (window as Window & { oldScene?: Element }).oldScene = document.querySelector('[data-project-scene]') ?? undefined;
      });
      for (let round = 0; round < 3; round++) {
        await page.evaluate((html: string) => {
          const gallery = document.getElementById('project-gallery') as HTMLElement;
          gallery.innerHTML = html;
          gallery.dispatchEvent(new Event('htmx:after:swap', { bubbles: true }));
        }, fixture);
        await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
      }
      const cleaned = await page.evaluate(() => {
        const oldFrame = (window as Window & { oldFrame?: Element }).oldFrame;
        return {
          oldHasState: oldFrame?.hasAttribute('data-image-motion') ?? false,
          oldConnected: oldFrame?.isConnected ?? false,
          scriptTags: document.querySelectorAll('script[src="/public/projects-motion.js"]').length,
          frames: document.querySelectorAll('.project-cover').length,
          oldSceneSrc: (window as Window & { oldScene?: Element }).oldScene?.getAttribute('src'),
          oldSceneConnected: (window as Window & { oldScene?: Element }).oldScene?.isConnected,
        };
      });
      assert.equal(cleaned.oldHasState, false, 'detached frames must lose their enhancement state');
      assert.equal(cleaned.oldConnected, false);
      assert.equal(cleaned.oldSceneSrc, null, 'detached animations must lose their source, not just become hidden');
      assert.equal(cleaned.oldSceneConnected, false);
      assert.equal(cleaned.scriptTags, 1, 'the shared script must not be duplicated');
      assert.equal(cleaned.frames, 2);
      await page.waitForFunction(() => {
        const frames = [...document.querySelectorAll('.project-cover')];
        return frames.length === 2 && frames.every((frame) => frame.getAttribute('data-image-motion') === 'active');
      });
      const single = await page.evaluate(() =>
        [...document.querySelectorAll('.project-cover')].map((frame) => ({
          state: frame.getAttribute('data-image-motion'),
          animations: frame.querySelectorAll('[data-project-scene]').length,
        })),
      );
      assert.equal(
        single.filter((frame: { state: string | null }) => frame.state === 'active').length,
        2,
        'all visible cards must autoplay',
      );
      assert.ok(
        single.every((frame: { animations: number }) => frame.animations === 1),
        'each frame must have exactly one scene',
      );
      await page.screenshot({ path: shot('gallery-htmx-reinsert') });

      await page.evaluate(
        (html: string) => {
          const gallery = document.getElementById('project-gallery') as HTMLElement;
          const template = document.createElement('template');
          template.innerHTML = html.trim();
          const later = template.content.firstElementChild as HTMLElement;
          later.setAttribute('data-fixture', 'later');
          gallery.append(later);
          gallery.dispatchEvent(new Event('htmx:after:swap', { bubbles: true }));
        },
        await card(9, 'Later project', PANTHEON),
      );
      await page.locator('[data-fixture="later"] .project-cover').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-fixture="later"] img')?.dataset.loaded === 'true');
      await page.waitForFunction(
        () => document.querySelector('[data-fixture="later"] .project-cover')?.getAttribute('data-image-motion') === 'active',
      );
    } finally {
      await context.close();
    }
  });

  await check('no-JavaScript visitors keep the static image and no decoration', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.route('**/api/projects', async (route: BrowserRoute) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: await card(4, 'Pantheon', PANTHEON) }),
    );
    await page.route('**/projects/4', (route: BrowserRoute) => route.fulfill({ status: 200, contentType: 'text/html', body: detailHtml }));
    try {
      await page.goto('/projects/4', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-project-preview]');
      const state = await page.evaluate(() => {
        const image = document.querySelector<HTMLImageElement>('[data-project-preview]');
        const frame = image?.closest('picture')?.parentElement;
        return {
          attr: frame?.getAttribute('data-image-motion') ?? null,
          animations: frame?.getAnimations({ subtree: true }).length ?? -1,
          loaded: Boolean(image?.complete && image.naturalWidth > 0),
          src: image?.getAttribute('src'),
        };
      });
      assert.equal(state.attr, null);
      assert.equal(state.animations, 0);
      assert.equal(state.loaded, true);
      assert.equal(state.src, `${PANTHEON}.png`);
      await page.screenshot({ path: shot('detail-nojs-1440') });
      await page.goto('/projects', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-project-loading]');
      assert.equal(await page.locator('[data-image-motion]').count(), 0);
      await page.screenshot({ path: shot('gallery-nojs') });
    } finally {
      await context.close();
    }
  });

  for (const name of ['pantheon', 'bg-platform', 'interpreter']) {
    for (const surface of ['card', 'detail'] as const) {
      await check(`${name} ${surface} renders changing scene pixels without CSS animation`, async () => {
        const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
        const page = await openPage(context);
        const base = `/public/projects/${name}-pixel`;
        try {
          if (surface === 'card') {
            await galleryRoute(context, card(4, name, base));
            await page.goto('/projects');
            await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
          } else {
            await context.route('**/projects/4', (route: BrowserRoute) =>
              detailFixture(base, detailBody).then((body) => route.fulfill({ contentType: 'text/html', body })),
            );
            await page.goto('/projects/4');
            await page.locator('[data-project-preview]').scrollIntoViewIfNeeded();
          }
          await waitForAttr(page, surface, 'active');
          const scene = page.locator('[data-project-scene]');
          const first = await scene.screenshot({ path: shot(`${name}-${surface}-frame-a`) });
          await page.waitForTimeout(1400);
          const second = await scene.screenshot({ path: shot(`${name}-${surface}-frame-b`) });
          assert.ok(!first.equals(second), 'the actual scene image must have different decoded frames');
          const state = await probe(page, surface);
          assert.equal(state?.animations.length, 0);
          assert.equal(state?.scene?.width, surface === 'card' ? 480 : 960);
          return state;
        } finally {
          await context.close();
        }
      });
    }
  }

  await check('failed animation retains decoded static artwork and does not retry on reactivation', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await openPage(context);
    const requests = motionRequests(page);
    await galleryRoute(context, card(4, 'Pantheon', PANTHEON));
    await page.route('**/*-motion-*.webp', (route: BrowserRoute) => route.fulfill({ contentType: 'image/webp', body: 'invalid WebP' }));
    try {
      await page.goto('/projects');
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
      await page.waitForTimeout(600);
      const state = assertIdle(await probe(page, 'card'), 'ready');
      assert.ok(state.image.naturalWidth > 0);
      assert.equal(state.image.visibility, 'visible');
      assert.equal(requests.length, 1, 'autoplay must attempt the scene before any interaction');
      await page.mouse.move(0, 0);
      await page.locator('.project-card').hover();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await waitForAttr(page, 'card', null);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await waitForAttr(page, 'card', 'ready');
      await page.waitForTimeout(300);
      assert.equal(requests.length, 1);
      await page.screenshot({ path: shot('animation-failed-static') });
    } finally {
      await context.close();
    }
  });

  await check('pending animation cannot appear after scrolling offscreen or reduced-motion change', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await openPage(context);
    await galleryRoute(context, card(4, 'Pantheon', PANTHEON));
    const pending: (() => Promise<void>)[] = [];
    await page.route(
      '**/*-motion-*.webp',
      (route: BrowserRoute) =>
        new Promise<void>((resolve) => {
          pending.push(async () => {
            await route.continue().catch(() => {});
            resolve();
          });
        }),
    );
    try {
      await page.goto('/projects');
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
      await waitForAttr(page, 'card', 'loading');
      assert.equal((await probe(page, 'card'))?.image.visibility, 'visible');
      await page.evaluate(() => {
        const spacer = document.createElement('div');
        spacer.style.height = '2000px';
        document.getElementById('project-gallery')?.before(spacer);
      });
      await waitForAttr(page, 'card', 'ready');
      for (const release of pending) await release();
      await page.waitForTimeout(400);
      assertIdle(await probe(page, 'card'), 'ready');
      await page.locator('.project-cover').scrollIntoViewIfNeeded();
      await waitForAttr(page, 'card', 'loading');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await waitForAttr(page, 'card', null);
      for (const release of pending) await release();
      await page.waitForTimeout(400);
      assertIdle(await probe(page, 'card'), null);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.unroute('**/*-motion-*.webp');
      for (const release of pending) await release();
      await waitForAttr(page, 'card', 'active');
    } finally {
      for (const release of pending) await release();
      await context.close();
    }
  });

  await check('unknown images receive no animation enhancement', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await openPage(context);
    const requests = motionRequests(page);
    const html = (await card(4, 'Uploaded project', PANTHEON)).replace(/ data-project-motion="[^"]*"/, '');
    await galleryRoute(context, html);
    try {
      await page.goto('/projects');
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
      await page.locator('.project-card').hover();
      await page.waitForTimeout(300);
      assertIdle(await probe(page, 'card'), null);
      assert.equal(requests.length, 0);
    } finally {
      await context.close();
    }
  });

  await check('far-offscreen cards defer both static and animated downloads', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await openPage(context);
    const requests = motionRequests(page);
    await galleryRoute(context, `<div style="grid-column:1/-1;height:2000px"></div>${await card(4, 'Pantheon', PANTHEON)}`);
    try {
      await page.goto('/projects');
      await page.waitForSelector('.project-card', { state: 'attached' });
      await page.waitForTimeout(300);
      assertIdle(await probe(page, 'card'), null);
      assert.equal((await probe(page, 'card'))?.image.src, null);
      assert.equal(requests.length, 0);
      await page.locator('.project-cover').scrollIntoViewIfNeeded();
      await waitForAttr(page, 'card', 'active');
      await page.evaluate(() => scrollTo(0, 0));
      await waitForAttr(page, 'card', 'ready');
      assertIdle(await probe(page, 'card'), 'ready');
    } finally {
      await context.close();
    }
  });

  assert.deepEqual(failures, []);
  await Bun.write(`${output}/motion-results.json`, JSON.stringify({ checks, screenshots, failures, aiRequests }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, screenshots: screenshots.length, aiRequests }));
} catch (error) {
  await Bun.write(
    `${output}/motion-results.json`,
    JSON.stringify({ checks, screenshots, failures, aiRequests, crash: String(error) }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
