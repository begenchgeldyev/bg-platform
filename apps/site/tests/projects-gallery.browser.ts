// SITE_URL=http://localhost:8665 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs bun apps/site/tests/projects-gallery.browser.ts
// Real catalog coverage plus isolated loading/count/error checks. Never calls an AI provider.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.SITE_URL || 'http://localhost:8665';
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/projects-gallery';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
const expected = [
  { id: 4, name: 'Pantheon', image: '/public/projects/pantheon-pixel.png' },
  { id: 2, name: 'bg-platform', image: '/public/projects/bg-platform-pixel.png' },
  { id: 1, name: 'Interpreter', image: '/public/projects/interpreter-pixel.png' },
];
const report: { real: unknown[]; fixtures: unknown[]; assets: unknown[]; aiRequests: number } = {
  real: [],
  fixtures: [],
  assets: [],
  aiRequests: 0,
};
declare global {
  interface Window {
    galleryShifts: number[];
    coverDecodeHeld: boolean;
    releaseCoverDecode: () => void;
  }
}

function gate() {
  let release = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release: () => release() };
}

async function loadingRegressions() {
  const failures: string[] = [];
  const checks: unknown[] = [];
  const capture = async (name: string, check: () => Promise<void>) => {
    try {
      await check();
      checks.push({ name, passed: true });
    } catch (error) {
      failures.push(`${name}: ${String(error)}`);
      checks.push({ name, passed: false, error: String(error) });
    }
  };
  await capture('placeholder remains painted through deferred download and decoding', async () => {
    const bytes = gate();
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/api/ask**', (route: { abort: () => Promise<void> }) => {
      report.aiRequests++;
      return route.abort();
    });
    await context.route('**/public/projects/*', async (route: { continue: () => Promise<void> }) => {
      await bytes.ready;
      await route.continue();
    });
    await context.addInitScript(() => {
      window.galleryShifts = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!shift.hadRecentInput) window.galleryShifts.push(shift.value);
        }
      }).observe({ type: 'layout-shift', buffered: true });
      const decode = HTMLImageElement.prototype.decode;
      const pending = new Promise<void>((resolve) => {
        window.releaseCoverDecode = resolve;
      });
      window.coverDecodeHeld = false;
      HTMLImageElement.prototype.decode = async function () {
        await decode.call(this);
        if (this.hasAttribute('data-project-cover')) {
          window.coverDecodeHeld = true;
          await pending;
        }
      };
    });
    const page = await context.newPage();
    try {
      await page.goto('/projects', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.project-card');
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.hasAttribute('src'));
      await page.evaluate(() => document.fonts.ready);
      const state = () =>
        page
          .locator('.project-cover')
          .first()
          .evaluate((cover: Element) => {
            const image = cover.querySelector('img') as HTMLImageElement;
            const rect = cover.getBoundingClientRect();
            // A transparent <picture> can win hit testing without painting over the fallback.
            const painted = document
              .elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
              .find((layer) => layer.matches('img') || layer.closest('.project-cover-fallback'));
            return {
              height: rect.height,
              width: rect.width,
              loaded: image.naturalWidth > 0,
              fallbackOnTop: Boolean(painted?.closest('.project-cover-fallback')),
              imageVisible: getComputedStyle(image).visibility === 'visible' && getComputedStyle(image).display !== 'none',
              background: getComputedStyle(image).backgroundColor,
              animations: cover.getAnimations({ subtree: true }).length,
            };
          });
      const pending = await state();
      await page.screenshot({ path: `${output}/loading-before-bytes.png` });
      assert.equal(pending.loaded, false);
      assert.equal(pending.fallbackOnTop, true, 'download must not cover the fallback with an empty image matte');
      assert.equal(await page.locator('[data-project-cover]').last().getAttribute('src'), null, 'offscreen image stays deferred');
      bytes.release();
      await page.waitForFunction(() => window.coverDecodeHeld);
      const decoding = await state();
      assert.equal(decoding.fallbackOnTop, true, 'fallback stays visible until decoding completes');
      assert.equal(decoding.height, pending.height);
      await page.screenshot({ path: `${output}/loading-during-decode.png` });
      await page.evaluate(() => window.releaseCoverDecode());
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('[data-project-cover]') as Element).visibility === 'visible',
      );
      const loaded = await state();
      assert.equal(loaded.loaded, true);
      assert.equal(loaded.fallbackOnTop, false);
      assert.equal(loaded.height, pending.height);
      assert.equal(loaded.background, 'rgb(17, 28, 40)', 'loaded transparent uploads retain an opaque matte');
      assert.equal(loaded.animations, 0);
      await page.screenshot({ path: `${output}/loading-after-decode.png` });
      await page
        .locator('[data-project-cover]')
        .first()
        .evaluate((image: HTMLImageElement) => {
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          image.closest('picture')?.querySelector('source')?.remove();
          delete image.dataset.loaded;
          image.src = canvas.toDataURL('image/png');
        });
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.dataset.loaded === 'true');
      const transparent = await state();
      assert.equal(transparent.fallbackOnTop, false, 'loaded transparent uploads must not expose the icon beneath');
      assert.equal(transparent.background, 'rgb(17, 28, 40)');
      assert.equal(transparent.height, pending.height);
      await page.screenshot({ path: `${output}/loading-transparent-matte.png` });
      assert.equal(await page.evaluate(() => window.galleryShifts.reduce((sum, value) => sum + value, 0)), 0);
    } finally {
      bytes.release();
      await context.close();
    }
  });
  for (const lang of ['en', 'ru']) {
    await capture(`visible ${lang} slow retry, second failure and successful keyboard recovery`, async () => {
      const second = gate();
      const third = gate();
      const startedSecond = gate();
      const startedThird = gate();
      const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
      await context.addCookies([{ name: 'lang', value: lang, url: baseURL }]);
      await context.route('**/api/ask**', (route: { abort: () => Promise<void> }) => {
        report.aiRequests++;
        return route.abort();
      });
      let requests = 0;
      await context.route(
        '**/api/projects',
        async (route: { fulfill: (data: unknown) => Promise<void>; continue: () => Promise<void> }) => {
          requests++;
          if (requests === 1) return route.fulfill({ status: 503, body: 'Unavailable' });
          if (requests === 2) {
            startedSecond.release();
            await second.ready;
            return route.fulfill({ status: 503, body: 'Unavailable again' });
          }
          startedThird.release();
          await third.ready;
          return route.continue();
        },
      );
      const page = await context.newPage();
      try {
        await page.goto('/projects', { waitUntil: 'domcontentloaded' });
        const button = page.locator('#project-retry');
        const status = page.locator('#project-load-error [role=status]');
        await button.waitFor({ state: 'visible' });
        await page.evaluate(() => document.fonts.ready);
        const errorText = await status.innerText();
        const loadingText = (await page.locator('[data-project-loading]').textContent()).trim();
        const positions = () =>
          page.evaluate(() => ({
            panelHeight: document.getElementById('project-load-error')?.getBoundingClientRect().height,
            footerY: document.querySelector('footer')?.getBoundingClientRect().y,
            loadingHeight: document.querySelector('[data-project-loading]')?.getBoundingClientRect().height,
          }));
        const before = await positions();
        await button.focus();
        await page.keyboard.press('Enter');
        await startedSecond.ready;
        await page.screenshot({ path: `${output}/retry-pending-${lang}.png` });
        assert.equal(await status.innerText(), loadingText, 'pending retry must show the existing localized loading message');
        assert.equal(await button.isVisible(), true);
        assert.equal(await button.evaluate((el: Element) => el === document.activeElement), true);
        assert.deepEqual(await positions(), before, 'pending text must not reinsert a tall loader or move the footer');
        await page.keyboard.press('Enter');
        await button.dispatchEvent('mousedown', { button: 0 });
        await button.dispatchEvent('click', { detail: 0 });
        assert.equal(requests, 2, 'repeated activation while pending must not issue another request');
        second.release();
        await page.waitForFunction(() => document.getElementById('project-gallery')?.getAttribute('aria-busy') === 'false');
        assert.equal(await status.innerText(), errorText);
        assert.equal(await button.getAttribute('aria-disabled'), null);
        assert.equal(await button.evaluate((el: Element) => el === document.activeElement), true);
        assert.equal(requests, 2);
        await button.click();
        await startedThird.ready;
        assert.equal(await status.innerText(), loadingText);
        assert.deepEqual(await positions(), before);
        third.release();
        await page.waitForSelector('.project-card');
        assert.equal(await page.locator('#project-load-error').isVisible(), false);
        assert.equal(
          await page
            .locator('.project-card-link')
            .first()
            .evaluate((el: Element) => el === document.activeElement),
          true,
        );
        assert.equal(requests, 3, 'one initial load and exactly two intentional retries');
      } finally {
        second.release();
        third.release();
        await context.close();
      }
    });
  }
  await capture('successful empty retry receives focus without a new Tab stop', async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 900 } });
    await context.route('**/api/ask**', (route: { abort: () => Promise<void> }) => {
      report.aiRequests++;
      return route.abort();
    });
    const emptyTemplate = (await Bun.file(new URL('../components/projects/empty-state.html', import.meta.url)).text())
      .replace('{{ emptyTitle }}', 'No published projects yet')
      .replace('{{ emptyDescription }}', 'There are no published entries to display yet.');
    let requests = 0;
    await context.route('**/api/projects', (route: { fulfill: (data: unknown) => Promise<void> }) => {
      requests++;
      return route.fulfill(
        requests === 1 ? { status: 503, body: 'Unavailable' } : { status: 200, contentType: 'text/html', body: emptyTemplate },
      );
    });
    const page = await context.newPage();
    try {
      await page.goto('/projects', { waitUntil: 'domcontentloaded' });
      await page.locator('#project-retry').waitFor({ state: 'visible' });
      await page.locator('#project-retry').focus();
      await page.keyboard.press('Enter');
      await page.waitForSelector('.project-empty');
      assert.equal(await page.locator('.project-empty').evaluate((el: Element) => el === document.activeElement), true);
      assert.equal(await page.locator('.project-empty').getAttribute('tabindex'), '-1');
      assert.equal(await page.locator('#project-load-error').isVisible(), false);
      assert.equal(requests, 2);
      await page.screenshot({ path: `${output}/retry-empty-focus.png` });
      await page.goto('/projects', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.project-empty');
      assert.equal(
        await page.locator('.project-empty').evaluate((el: Element) => el === document.activeElement),
        false,
        'initial load must not steal focus',
      );
    } finally {
      await context.close();
    }
  });
  await Bun.write(`${output}/loading-results.json`, JSON.stringify({ checks, failures }, null, 2));
  assert.deepEqual(failures, []);
}

function geometry() {
  const bounds = (element: Element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  };
  return {
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    cards: [...document.querySelectorAll('.project-card')].map((element) => ({
      ...bounds(element),
      name: element.querySelector('h2')?.textContent?.trim(),
      cover: bounds(element.querySelector('.project-cover') as Element),
    })),
    descriptions: [...document.querySelectorAll('.project-description')].map((element) => ({
      text: element.textContent?.trim(),
      clamp: getComputedStyle(element).webkitLineClamp,
      clipped: element.scrollHeight > element.clientHeight,
      fontSize: getComputedStyle(element).fontSize,
    })),
    images: [...document.querySelectorAll<HTMLImageElement>('[data-project-cover]')].map((image) => ({
      png: image.dataset.src,
      source: image.currentSrc,
      width: image.naturalWidth,
      height: image.naturalHeight,
      loading: image.loading,
      decoding: image.decoding,
      opacity: getComputedStyle(image).opacity,
      visibility: getComputedStyle(image).visibility,
      filter: getComputedStyle(image).filter,
      objectFit: getComputedStyle(image).objectFit,
      rendering: getComputedStyle(image).imageRendering,
    })),
    overflow: [...document.querySelectorAll('.project-card, .project-description, .project-technologies, .project-card-action')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1;
      })
      .map((element) => element.className),
  };
}

try {
  await loadingRegressions();
  if (process.env.GALLERY_LOADING_ONLY === '1') {
    console.log('All bounded loading regressions passed.');
    await browser.close();
    process.exit(0);
  }
  for (const lang of ['en', 'ru']) {
    for (const width of lang === 'en' ? [320, 390, 768, 1440] : [320, 390, 1440]) {
      console.log(`Real gallery: ${lang} ${width}`);
      const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await context.addCookies([{ name: 'lang', value: lang, url: baseURL }]);
      await context.route('**/api/ask**', (route: { abort: () => Promise<void> }) => {
        report.aiRequests++;
        return route.abort();
      });
      await context.addInitScript(() => {
        window.galleryShifts = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
            if (!shift.hadRecentInput) window.galleryShifts.push(shift.value);
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error: Error) => errors.push(error.message));
      page.on('console', (message: { type: () => string; text: () => string }) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      const requests: string[] = [];
      page.on('request', (request: { url: () => string }) => {
        if (request.url().includes('/public/projects/')) requests.push(request.url());
      });
      const dataResponse = await context.request.get('/api/projects');
      assert.equal(dataResponse.status(), 200);
      const data = (await dataResponse.json()) as { projects: { id: number; name: string; image: string; description: string }[] };
      assert.deepEqual(
        data.projects.map(({ id, name, image }) => ({ id, name, image })),
        expected,
      );
      const response = await page.goto('/projects', { waitUntil: 'domcontentloaded', timeout: 60000 });
      assert.equal(response.status(), 200);
      await page.waitForSelector('.project-card');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.naturalWidth === 1448);
      const initialRequests = [...requests];
      if (width < 640) assert.ok(initialRequests.length < 3, 'offscreen covers must not all download on mobile');
      const reservedBefore = await page
        .locator('.project-cover')
        .evaluateAll((covers: Element[]) => covers.map((x) => x.getBoundingClientRect().height));
      const imageCLSStart = await page.evaluate(() => window.galleryShifts.length);
      for (let i = 0; i < 3; i++) {
        const image = page.locator('[data-project-cover]').nth(i);
        await image.scrollIntoViewIfNeeded();
        await image.evaluate(async (element: HTMLImageElement) => {
          if (!element.src) await new Promise<void>((resolve) => element.addEventListener('load', () => resolve(), { once: true }));
          await element.decode();
        });
      }
      await page.evaluate(() => scrollTo(0, 0));
      const metrics = await page.evaluate(geometry);
      assert.equal(metrics.scrollWidth, width);
      assert.equal(metrics.overflow.length, 0);
      assert.equal(metrics.cards.length, 3);
      assert.deepEqual(
        metrics.descriptions.map((x: { text: string }) => x.text),
        data.projects.map((x) => x.description),
      );
      assert.ok(metrics.descriptions.every((x: { clamp: string; clipped: boolean }) => x.clamp === 'none' && !x.clipped));
      for (const image of metrics.images) {
        assert.equal(image.width, 1448);
        assert.equal(image.height, 1086);
        assert.equal(image.opacity, '1');
        assert.equal(image.visibility, 'visible');
        assert.equal(image.filter, 'none');
        assert.equal(image.objectFit, 'contain');
        assert.equal(image.rendering, 'pixelated');
        assert.equal(image.loading, 'lazy');
        assert.equal(image.decoding, 'async');
        assert.ok(image.source.endsWith('.webp'));
      }
      assert.ok(
        metrics.cards.every(
          (card: { cover: { width: number; height: number } }) => Math.abs(card.cover.width / card.cover.height - 4 / 3) < 0.01,
        ),
      );
      assert.deepEqual(
        metrics.cards.map((card: { cover: { height: number } }) => card.cover.height),
        reservedBefore,
      );
      if (width === 1440) {
        assert.ok(
          metrics.cards.every(
            (card: { y: number; width: number }) => card.y === metrics.cards[0].y && Math.abs(card.width - metrics.cards[0].width) < 1,
          ),
        );
      } else if (width === 768) {
        assert.equal(metrics.cards[0].y, metrics.cards[1].y);
        assert.ok(metrics.cards[2].y > metrics.cards[0].y, 'tablet uses two equal columns');
        assert.ok(Math.abs(metrics.cards[0].width - metrics.cards[1].width) < 1);
      } else {
        assert.ok(metrics.cards.every((card: { x: number }) => card.x === metrics.cards[0].x));
      }
      const shifts = await page.evaluate(
        (start: number) => ({ all: window.galleryShifts, afterImages: window.galleryShifts.slice(start) }),
        imageCLSStart,
      );
      assert.equal(
        shifts.afterImages.reduce((sum: number, value: number) => sum + value, 0),
        0,
      );
      assert.equal(
        shifts.all.reduce((sum: number, value: number) => sum + value, 0),
        0,
        'Loading and images must not shift visible content',
      );
      assert.equal(await page.locator('.project-card-action').first().innerText(), lang === 'ru' ? 'Открыть проект\n→' : 'View project\n→');
      assert.equal(await page.locator('.project-card-link a, .project-card-link button').count(), 0);
      assert.equal(await page.locator('.project-card-link[aria-describedby]').count(), 0, 'public card names remain unchanged');
      await page.screenshot({ path: `${output}/gallery-${lang}-${width}.png`, fullPage: true });
      // Use keyboard navigation from the header into the first card, then its actual detail route.
      await page.locator('header button').last().focus();
      await page.keyboard.press('Tab');
      assert.equal(
        await page
          .locator('.project-card-link')
          .first()
          .evaluate((el: Element) => el === document.activeElement),
        true,
      );
      const focus = await page
        .locator('.project-card-link')
        .first()
        .evaluate((el: Element) => ({ visible: el.matches(':focus-visible'), outline: getComputedStyle(el).outlineWidth }));
      assert.equal(focus.visible, true);
      assert.equal(focus.outline, '2px');
      await page.screenshot({ path: `${output}/focus-${lang}-${width}.png` });
      await page.keyboard.press('Enter');
      await page.waitForURL('**/projects/4');
      assert.equal(await page.locator('a[href="https://github.com/begenchgeldyev/pantheon"]').count(), 1);
      assert.equal(await page.locator('#project-upload-trigger').count(), 0);
      assert.deepEqual(errors, []);
      report.real.push({ lang, width, metrics, initialRequests, totalArtworkRequests: requests.length, shifts, errors });
      if (lang === 'en' && width === 1440) {
        for (const item of expected) {
          const detail = await page.goto(`/projects/${item.id}`, { waitUntil: 'domcontentloaded' });
          assert.equal(detail.status(), 200);
          assert.equal((await page.locator('[data-project-field="name"]').innerText()).trim().toLowerCase(), item.name.toLowerCase());
          if (item.id !== 1) {
            assert.equal(
              await page
                .locator(`[data-project-field="content"] a[href="https://github.com/begenchgeldyev/${item.name.toLowerCase()}"]`)
                .count(),
              1,
            );
          } else {
            assert.equal(await page.locator('[data-project-field="content"] a[href*="github.com"]').count(), 0);
          }
          for (const extension of ['png', 'webp']) {
            const url = item.image.replace(/png$/, extension);
            const asset = await context.request.get(url);
            assert.equal(asset.status(), 200);
            assert.ok(asset.headers()['content-type'].startsWith(`image/${extension}`));
            const body = await asset.body();
            // Compare served bytes to the exact tracked public asset, not a remote URL.
            const file = Bun.file(new URL(`../public/projects/${url.split('/').pop()}`, import.meta.url));
            assert.deepEqual(Buffer.from(await file.arrayBuffer()), body);
            report.assets.push({ url, status: asset.status(), bytes: body.length, matchesFile: true });
          }
        }
      }
      await context.close();
      await Bun.write(`${output}/results.json`, JSON.stringify(report, null, 2));
    }
  }

  // Synthetic robustness cases are deliberately separate from all real-data proof above.
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  await context.route('**/api/ask**', (route: { abort: () => Promise<void> }) => {
    report.aiRequests++;
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto('/projects');
  await page.waitForSelector('.project-card');
  assert.equal(
    await page
      .locator('.project-card')
      .evaluateAll((cards: Element[]) => cards.flatMap((card) => card.getAnimations({ subtree: true })).length),
    0,
  );
  report.fixtures.push({ type: 'normal-motion-no-new-gallery-animation', passed: true });
  const template = await page
    .locator('.project-card')
    .first()
    .evaluate((el: Element) => el.outerHTML);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const count of [0, 1, 2, 3, 5]) {
      await page.evaluate(
        ({ template, count }: { template: string; count: number }) => {
          const gallery = document.getElementById('project-gallery') as HTMLElement;
          gallery.innerHTML = count ? template.repeat(count) : '<div class="project-empty">No published projects yet</div>';
          [...gallery.querySelectorAll('h2')].forEach((title, i) => {
            title.id = `fixture-${i}`;
          });
        },
        { template, count },
      );
      const metrics = await page.evaluate(geometry);
      assert.equal(metrics.cards.length, count);
      assert.equal(metrics.scrollWidth, width);
      assert.equal(metrics.overflow.length, 0);
      if (count > 1) assert.ok(metrics.cards.every((card: { width: number }) => Math.abs(card.width - metrics.cards[0].width) < 1));
      report.fixtures.push({ type: 'count-layout', width, count, passed: true });
    }
  }
  // A failed list request has a real keyboard-accessible retry, not a stuck loading message.
  await context.route(
    '**/api/projects',
    (route: { fulfill: (data: unknown) => Promise<void> }) => route.fulfill({ status: 503, body: 'Unavailable' }),
    { times: 1 },
  );
  await page.goto('/projects');
  await page.locator('#project-retry').waitFor({ state: 'visible' });
  await page.locator('#project-retry').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.project-card');
  assert.equal(await page.locator('#project-load-error').isVisible(), false);
  assert.equal(
    await page
      .locator('.project-card-link')
      .first()
      .evaluate((el: Element) => el === document.activeElement),
    true,
  );
  report.fixtures.push({ type: 'list-error-and-keyboard-retry', passed: true });

  // Missing derivative falls back to its PNG; failed PNG then exposes the decorative fallback.
  await context.route('**/public/projects/*.webp', (route: { abort: () => Promise<void> }) => route.abort());
  await page.goto('/projects');
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-project-cover]')?.naturalWidth === 1448);
  assert.ok(
    (
      await page
        .locator('[data-project-cover]')
        .first()
        .evaluate((el: HTMLImageElement) => el.currentSrc)
    ).endsWith('.png'),
  );
  await context.route('**/public/projects/*.png', (route: { abort: () => Promise<void> }) => route.abort());
  await page.goto('/projects');
  await page.waitForFunction(() => document.querySelector<HTMLPictureElement>('.project-cover picture')?.hidden);
  assert.equal(await page.locator('.project-cover-fallback').first().isVisible(), true);
  assert.equal(await page.locator('.project-card-link').first().getAttribute('href'), '/projects/4');
  report.fixtures.push({ type: 'webp-png-error-fallback', passed: true });
  await context.close();
  assert.equal(report.aiRequests, 0);
  await Bun.write(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      realCases: report.real.length,
      fixtureCases: report.fixtures.length,
      assets: report.assets.length,
      aiRequests: report.aiRequests,
    }),
  );
} finally {
  await browser.close();
}
