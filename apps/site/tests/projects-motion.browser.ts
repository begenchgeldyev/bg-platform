// SITE_URL=http://localhost:8681 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs bun apps/site/tests/projects-motion.browser.ts
// Authored image-motion behavior on the real gallery page and a rendered project page.
// The gallery API and the detail route use fixtures because local Postgres is optional.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { renderComponentTemplate, renderDocument } from '../site';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.SITE_URL || 'http://localhost:8681';
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/projects-motion';
const executablePath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
await mkdir(output, { recursive: true });

const PANTHEON = '/public/projects/pantheon-pixel';
const PLATFORM = '/public/projects/bg-platform-pixel';
const CARD_SIZES = '(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 384px';
const DETAIL_SIZES = '(max-width: 767px) 100vw, 768px';
const cardTemplate = await Bun.file(new URL('../components/projects/card.html', import.meta.url)).text();
const motionTemplateUrl = new URL('../components/projects/image-motion.html', import.meta.url);
const motionPartial = (await Bun.file(motionTemplateUrl).exists()) ? await Bun.file(motionTemplateUrl).text() : '';

const browser = await chromium.launch({ executablePath, headless: true });
const checks: { name: string; passed: boolean; data?: unknown; error?: string }[] = [];
const screenshots: string[] = [];
const failures: string[] = [];
let aiRequests = 0;

function sources(base: string, sizes: string, lazy: boolean) {
  const attribute = lazy ? 'data-srcset' : 'srcset';
  const set = (format: string) => [400, 800, 1200, 1448].map((width) => `${base}-${width}.${format} ${width}w`).join(', ');
  return `<source type="image/avif" sizes="${sizes}" ${attribute}="${set('avif')}"><source type="image/webp" sizes="${sizes}" ${attribute}="${set('webp')}">`;
}

function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => values[key] ?? '');
}

function card(id: number, name: string, base: string) {
  const picture = `<picture>${sources(base, CARD_SIZES, true)}<img data-project-cover data-src="${base}.png" width="1448" height="1086" loading="lazy" decoding="async" alt=""></picture>`;
  return fill(cardTemplate, {
    description: `${name} fixture description`,
    hiddenBadge: '',
    icon: 'terminal',
    name,
    pictureHtml: picture,
    projectHref: `/projects/${id}`,
    projectId: String(id),
    tagsHtml: '',
    viewProjectText: 'View project',
    visibilityDescription: '',
  });
}

async function detailFixture(base: string, content: string) {
  const imageBlock = `<div class="overflow-hidden border border-outline-variant/30 bg-surface">
    <picture>${sources(base, DETAIL_SIZES, false)}<img data-project-preview class="max-h-[520px] w-full object-cover" src="${base}.png" width="1448" height="1086" fetchpriority="high" decoding="async" alt="Pantheon preview"></picture>
  </div>`;
  const pageHtml = await renderComponentTemplate('projects/page.html', {
    adminControls: '',
    content,
    contentEditableAttrs: '',
    createdAt: 'Jan 01, 2026',
    description: 'Fixture description',
    editor: '',
    headerEditableAttrs: '',
    imageBlock,
    imageMotion: motionPartial,
    projectId: '4',
    projectName: 'Pantheon',
    route: '/projects/4',
    tagsHtml: '',
    updatedAt: 'Jan 01, 2026',
    visibility: 'Published',
  });
  return renderDocument(
    {
      title: { en: 'FIXTURE — BEGENCH_GELDYEV@ROOT:~$', ru: 'FIXTURE' },
      fragmentFile: 'projects.html',
      activeNav: 'projects',
      brandIsLink: true,
    },
    pageHtml,
    'en',
  );
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

async function openPage(context: BrowserContext) {
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.route('**/api/ask**', (route) => {
    aiRequests++;
    return route.abort();
  });
  return page;
}

async function probe(page: BrowserPage, kind: 'card' | 'detail') {
  return page.evaluate((surface) => {
    const image = document.querySelector<HTMLImageElement>(surface === 'card' ? '[data-project-cover]' : '[data-project-preview]');
    const frame = surface === 'card' ? image?.closest('.project-cover') : image?.closest('picture')?.parentElement;
    if (!image || !frame) return null;
    const after = getComputedStyle(frame, '::after');
    const before = getComputedStyle(frame, '::before');
    const animations = frame.getAnimations({ subtree: true });
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
      running: animations.some((animation) => animation.playState === 'running'),
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
    ({ surface, expected }) => {
      const image = document.querySelector<HTMLImageElement>(surface === 'card' ? '[data-project-cover]' : '[data-project-preview]');
      const frame = surface === 'card' ? image?.closest('.project-cover') : image?.closest('picture')?.parentElement;
      if (!frame) return false;
      return expected === null ? !frame.hasAttribute('data-image-motion') : frame.getAttribute('data-image-motion') === expected;
    },
    { surface: kind, expected: value },
  );
}

async function freezeAt(page: BrowserPage, kind: 'card' | 'detail', at: number) {
  await page.evaluate(
    ({ surface, time }) => {
      const image = document.querySelector<HTMLImageElement>(surface === 'card' ? '[data-project-cover]' : '[data-project-preview]');
      const frame = surface === 'card' ? image?.closest('.project-cover') : image?.closest('picture')?.parentElement;
      for (const animation of frame?.getAnimations({ subtree: true }) ?? []) {
        animation.pause();
        animation.currentTime = time;
      }
    },
    { surface: kind, time: at },
  );
}

async function resume(page: BrowserPage, kind: 'card' | 'detail') {
  await page.evaluate((surface) => {
    const image = document.querySelector<HTMLImageElement>(surface === 'card' ? '[data-project-cover]' : '[data-project-preview]');
    const frame = surface === 'card' ? image?.closest('.project-cover') : image?.closest('picture')?.parentElement;
    for (const animation of frame?.getAnimations({ subtree: true }) ?? []) animation.play();
  }, kind);
}

function assertIdle(state: Awaited<ReturnType<typeof probe>>, expected: string | null) {
  assert.ok(state, 'image frame must exist');
  assert.equal(state.attr, expected, 'frame must hold the documented idle state');
  assert.equal(state.running, false, 'idle frame must have no running animation');
  assert.equal(state.animations.length, 0, 'idle frame must have no animations');
  assert.equal(state.afterAnimation, 'none', 'idle overlay must have no animation');
  if (expected !== null) assert.equal(state.beforeOpacity, '0', 'idle corner cue must be hidden');
  return state;
}

function galleryRoute(context: BrowserContext, body: string) {
  return context.route('**/api/projects', (route) => route.fulfill({ status: 200, contentType: 'text/html', body }));
}

try {
  const detailHtml = await detailFixture(PANTHEON, detailBody);
  const failedDetailHtml = await detailFixture('/public/projects/missing-pixel', detailBody);
  await Bun.write(`${output}/detail-fixture.html`, detailHtml);
  await Bun.write(`${output}/detail-failed-fixture.html`, failedDetailHtml);

  await check('gallery hover starts authored motion only after the existing decode contract', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await openPage(context);
    await galleryRoute(context, card(4, 'Pantheon', PANTHEON));
    try {
      await page.goto('/projects', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.project-card');
      assert.equal(
        await page.evaluate(() => document.querySelectorAll('script[src="/public/projects-motion.js"]').length),
        1,
        'the shared motion enhancement must be included outside the swapped gallery content',
      );
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
      const idle = assertIdle(await probe(page, 'card'), 'ready');
      await page.screenshot({ path: shot('gallery-idle-1440') });
      assert.ok(idle.image.currentSrc.endsWith('.avif'), 'the responsive AVIF source must remain in use');
      await page.locator('.project-card').first().hover();
      await waitForAttr(page, 'card', 'active');
      const active = await probe(page, 'card');
      assert.ok(active, 'card probe');
      assert.equal(active.attr, 'active');
      assert.equal(active.mode, 'card');
      assert.equal(active.running, true, 'hover must run the authored animation');
      assert.equal(active.afterAnimation, 'image-signal-sweep');
      assert.ok(Number(active.beforeOpacity) > 0, 'hover must reveal the corner cue');
      assert.equal(active.overlayNodes, 0, 'motion must not add image layers');
      assert.deepEqual(active.rect, idle.rect, 'activation must not move the cover');
      assert.equal(active.image.src, idle.image.src);
      assert.equal(active.image.currentSrc, idle.image.currentSrc);
      assert.equal(active.image.loading, idle.image.loading);
      assert.equal(active.image.decoding, idle.image.decoding);
      const firstFrame = await page.locator('.project-cover').first().screenshot();
      await page.waitForTimeout(520);
      const secondFrame = await page.locator('.project-cover').first().screenshot();
      assert.ok(!firstFrame.equals(secondFrame), 'the light cue must visibly move across the artwork');
      const later = await probe(page, 'card');
      assert.ok(later, 'card probe');
      assert.notEqual(later.afterPosition, active.afterPosition, 'the stepped sweep must advance');
      await freezeAt(page, 'card', 1000);
      await page.screenshot({ path: shot('gallery-hover-1440') });
      await resume(page, 'card');
      await page.mouse.move(4, 4);
      await waitForAttr(page, 'card', 'ready');
      const stopped = assertIdle(await probe(page, 'card'), 'ready');
      await Bun.write(`${output}/gallery-hover-frames.json`, JSON.stringify({ idle, active, later, stopped }, null, 2));
    } finally {
      await context.close();
    }
  });

  await check('keyboard focus runs motion and leaving focus stops it', async () => {
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
          .evaluate((element) => element.matches(':focus-visible')),
        true,
      );
      await freezeAt(page, 'card', 1000);
      await page.screenshot({ path: shot('gallery-focus-1440') });
      await resume(page, 'card');
      await page
        .locator('.project-card-link')
        .first()
        .evaluate((element) => (element as HTMLElement).blur());
      await waitForAttr(page, 'card', 'ready');
      assertIdle(await probe(page, 'card'), 'ready');
    } finally {
      await context.close();
    }
  });

  await check('reduced motion stays static and follows a live preference change', async () => {
    const reduced = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const reducedPage = await openPage(reduced);
    await galleryRoute(reduced, card(4, 'Pantheon', PANTHEON));
    try {
      await reducedPage.goto('/projects', { waitUntil: 'domcontentloaded' });
      await reducedPage.waitForSelector('.project-card');
      await reducedPage.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
      await reducedPage.locator('.project-card').first().hover();
      await reducedPage.waitForTimeout(260);
      assertIdle(await probe(reducedPage, 'card'), null);
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
      await page.locator('.project-card').first().hover();
      await waitForAttr(page, 'card', 'active');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await waitForAttr(page, 'card', null);
      assertIdle(await probe(page, 'card'), null);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.waitForFunction(() => {
        const state = document.querySelector('[data-project-cover]')?.closest('.project-cover')?.getAttribute('data-image-motion');
        return state === 'ready' || state === 'active';
      });
    } finally {
      await live.close();
    }
  });

  await check('touch-only cards stay static and keep navigating', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await openPage(context);
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
      assertIdle(await probe(page, 'card'), 'ready');
      await page.screenshot({ path: shot('gallery-narrow-idle-390') });
      await page.locator('.project-card').first().hover();
      await page.waitForTimeout(260);
      assertIdle(await probe(page, 'card'), 'ready');
      await page.screenshot({ path: shot('gallery-narrow-coarse-390') });
      await page.locator('.project-card-link').first().click();
      await page.waitForURL('**/projects/4');
      assert.ok(page.url().includes('/projects/4'), 'the card must remain a working link');
    } finally {
      await context.close();
    }
  });

  await check('a project page animates while visible and stops when scrolled away or hidden', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await openPage(context);
    await context.route('**/projects/4', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: detailHtml }));
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
      assert.equal(active?.afterAnimation, 'image-signal-sweep');
      await page.evaluate(() => document.querySelector('[data-project-preview]')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(420);
      await freezeAt(page, 'detail', 1600);
      await page.screenshot({ path: shot('detail-active-1440') });
      await resume(page, 'detail');
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
        delete (document as Document & { visibilityState?: string }).visibilityState;
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
    await context.route('**/projects/4', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: detailHtml }));
    try {
      await page.goto('/projects/4', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>('[data-project-preview]');
        return Boolean(image?.complete && image.naturalWidth > 0);
      });
      await page.waitForTimeout(300);
      assertIdle(await probe(page, 'detail'), null);
      await page.screenshot({ path: shot('detail-reduced-1440') });
    } finally {
      await context.close();
    }
  });

  await check('a failed image never receives decoration', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await openPage(context);
    await context.route('**/projects/4', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: failedDetailHtml }));
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
    await galleryContext.route('**/public/projects/*', (route) => route.abort());
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
    const fixture = [card(4, 'Pantheon', PANTHEON), card(2, 'bg-platform', PLATFORM)].join('');
    await galleryRoute(context, fixture);
    try {
      await page.goto('/projects', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.project-card');
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
      await page.evaluate(() => {
        (window as Window & { oldFrame?: Element }).oldFrame = document.querySelector('.project-cover') ?? undefined;
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
        };
      });
      assert.equal(cleaned.oldHasState, false, 'detached frames must lose their enhancement state');
      assert.equal(cleaned.oldConnected, false);
      assert.equal(cleaned.scriptTags, 1, 'the shared script must not be duplicated');
      assert.equal(cleaned.frames, 2);
      await page.locator('.project-card').nth(1).hover();
      await page.waitForFunction(() => {
        const frames = [...document.querySelectorAll('.project-cover')];
        return frames[1]?.getAttribute('data-image-motion') === 'active' && frames[0]?.getAttribute('data-image-motion') !== 'active';
      });
      const single = await page.evaluate(() =>
        [...document.querySelectorAll('.project-cover')].map((frame) => ({
          state: frame.getAttribute('data-image-motion'),
          animations: frame.getAnimations({ subtree: true }).length,
        })),
      );
      assert.equal(single.filter((frame) => frame.state === 'active').length, 1, 'only the hovered card may run');
      assert.ok((single[1]?.animations ?? 0) > 0);
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
        card(9, 'Later project', PANTHEON),
      );
      await page.locator('[data-fixture="later"] .project-cover').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-fixture="later"] img')?.dataset.loaded === 'true');
      await page.locator('[data-fixture="later"]').hover();
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
    await page.route('**/api/projects', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: card(4, 'Pantheon', PANTHEON) }),
    );
    await page.route('**/projects/4', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: detailHtml }));
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
