// SITE_URL=http://127.0.0.1:8682 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs bun apps/site/tests/projects-header.browser.ts
// Real preview cards/API; Russian document uses production rendering because the
// read-only local preview intentionally strips the language cookie upstream.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { renderPage } from '../site';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.SITE_URL || 'http://127.0.0.1:8682';
const output = process.env.EVIDENCE_DIR || '/tmp/opencode/projects-header-implementation';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
try {
  for (const lang of ['en', 'ru'] as const) {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        baseURL,
        viewport: { width, height: width === 390 ? 844 : 1000 },
        hasTouch: width === 390,
        isMobile: width === 390,
      });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        await page.route('**/api/ask**', () => {
          throw new Error('Header verification must not call AI');
        });
        if (lang === 'ru') {
          const response = await renderPage('/projects', 'ru');
          assert.ok(response);
          const body = await response.text();
          await page.route(`${baseURL}/projects`, (route: { fulfill(options: { contentType: string; body: string }): Promise<void> }) =>
            route.fulfill({ contentType: 'text/html', body }),
          );
        }
        await page.goto('/projects', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.project-card');
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        const heading = page.getByRole('heading', { level: 1 });
        assert.equal(await heading.count(), 1, 'the gallery needs a single accessible page heading');
        const headingBox = await heading.boundingBox();
        assert.ok(headingBox && headingBox.height <= 40, 'the path heading must stay compact, not restore the oversized introduction');
        assert.equal(await heading.innerText(), lang === 'en' ? 'projects' : 'проекты', 'the path heading must follow the page language');
        const header = page.locator('main > header');
        const cursor = header.locator('[aria-hidden="true"]').last();
        assert.equal(
          await cursor.evaluate((element: Element) => getComputedStyle(element).animationDuration),
          '2s',
          'projects cursor must use a slower two-second blink cycle',
        );
        const samples = await cursor.evaluate(async (element: Element) => {
          const samples = [];
          // Observe more than a full two-second cycle regardless of its starting phase.
          for (let i = 0; i < 24; i++) {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            samples.push({
              opacity: Number(style.opacity),
              background: style.backgroundColor,
              width: rect.width,
              height: rect.height,
              x: rect.x,
              y: rect.y,
            });
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return samples;
        });
        assert.equal(samples[0].background, 'rgb(0, 255, 65)', 'cursor must be a filled canonical-green terminal cell');
        assert.ok(samples[0].width >= 10 && samples[0].height > samples[0].width, 'cursor must be a tall glyph cell, not an underline');
        assert.ok(
          samples.some((sample: { opacity: number }) => sample.opacity === 0) &&
            samples.some((sample: { opacity: number }) => sample.opacity === 1),
          'cursor must blink',
        );
        assert.ok(
          samples.every((sample: { opacity: number }) => sample.opacity === 0 || sample.opacity === 1),
          'blink must step, not fade',
        );
        for (const sample of samples)
          assert.deepEqual(
            [sample.x, sample.y, sample.width, sample.height],
            [samples[0].x, samples[0].y, samples[0].width, samples[0].height],
            'blink cannot shift layout',
          );
        assert.equal(
          await header
            .locator('span')
            .first()
            .evaluate((element: Element) => getComputedStyle(element).color),
          'rgb(0, 255, 65)',
          'prefix uses the same accent',
        );
        assert.equal(
          (await header.innerText()).replace(/\s/g, ''),
          lang === 'en' ? '~/projects' : '~/проекты',
          'only the path belongs in header text, without count or introduction',
        );
        assert.equal(
          await header
            .locator('[aria-hidden="true"]')
            .allTextContents()
            .then((parts: string[]) => parts.join('')),
          '~/',
          'decorative path and cursor must not enter the accessible heading',
        );
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForTimeout(100);
        assert.deepEqual(
          await cursor.evaluate((element: Element) => ({
            opacity: getComputedStyle(element).opacity,
            animations: element.getAnimations().length,
          })),
          { opacity: '1', animations: 0 },
          'reduced motion shows a solid stationary block',
        );
        await page.screenshot({ path: `${output}/${lang}-${width}-reduced.png` });
        await Bun.write(`${output}/${lang}-${width}-blink.json`, JSON.stringify(samples, null, 2));
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        assert.equal(await page.locator('.prototype-switcher').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
        assert.equal(await page.locator('.project-card').count(), 3);
        for (let index = 0; index < 3; index++) {
          await page.locator('.project-cover').nth(index).scrollIntoViewIfNeeded();
          await page.waitForFunction((index: number) => {
            const frame = document.querySelectorAll('.project-cover')[index];
            const scene = frame?.querySelector<HTMLImageElement>('[data-project-scene]');
            return frame?.getAttribute('data-image-motion') === 'active' && scene && !scene.hidden && scene.naturalWidth > 0;
          }, index);
        }
        await page.evaluate(() => scrollTo(0, 0));
        await page.waitForTimeout(300);
        await page.waitForFunction(() => {
          const cursor = document.querySelector('.projects-header [aria-hidden="true"]:last-child');
          if (!cursor) throw new Error('Project header cursor is missing');
          return getComputedStyle(cursor).opacity === '1';
        });
        await page.screenshot({ path: `${output}/${lang}-${width}.png`, fullPage: true, animations: 'allow' });
        await page.screenshot({ path: `${output}/${lang}-${width}-viewport.png` });
        await page.locator('.project-card-link').first().click();
        await page.waitForURL('**/projects/3');
        console.log(
          `PASS ${lang}/${width}: compact accessible path; canonical green block; discrete blink without layout shift; reduced-motion solid; no overflow; three autoplay cards; navigation`,
        );
      } finally {
        await context.close();
      }
    }
  }
  const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 1000 } });
  await page.route('**/api/ask**', () => {
    throw new Error('Palette check must not call AI');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#terminal-input');
  const colors = await page.evaluate(() => {
    const color = (selector: string, property = 'color') => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Palette element is missing: ${selector}`);
      return getComputedStyle(element).getPropertyValue(property);
    };
    return {
      brand: color('header .font-mono'),
      footer: color('footer .text-primary-container'),
      prompt: color('#terminal-prompt'),
      caret: color('#terminal-input', 'caret-color'),
      button: color('a.bg-primary-container', 'background-color'),
      buttonText: color('a.bg-primary-container'),
      body: color('body'),
    };
  });
  for (const key of ['brand', 'footer', 'prompt', 'caret', 'button'] as const)
    assert.equal(colors[key], 'rgb(0, 255, 65)', `${key} must share canonical green`);
  assert.equal(colors.buttonText, 'rgb(10, 10, 10)', 'filled-green controls need dark neutral text');
  await page.screenshot({ path: `${output}/home-1440.png`, fullPage: true });
  console.log('PASS home brand/footer/terminal/caret/button share green; filled-button text retains dark contrast');
  for (const path of ['/', '/projects', '/projects/3', '/resume', '/logs']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const unexpected = await page.evaluate(() => {
      const unexpected: string[] = [];
      for (const element of document.querySelectorAll('body *')) {
        if (!element.getBoundingClientRect().width) continue;
        const style = getComputedStyle(element);
        for (const property of ['color', 'background-color', 'border-top-color', 'border-bottom-color', 'outline-color', 'caret-color']) {
          const value = style.getPropertyValue(property);
          const parts = value.match(/[\d.]+/g)?.map(Number);
          if (!parts || (parts.length === 4 && parts[3] === 0)) continue;
          const [r, g, b] = parts;
          if (g > r && g > b && !(r === 0 && g === 255 && b === 65))
            unexpected.push(`${element.tagName}.${element.className} ${property}: ${value}`);
        }
      }
      return unexpected;
    });
    assert.deepEqual(unexpected, [], `${path} must not render competing UI greens`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#terminal-input');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile home has no overflow');
  await page.screenshot({ path: `${output}/home-390.png`, fullPage: true });
  console.log('PASS rendered UI color audit: home, gallery, project page, Resume, logs; mobile home no overflow');
} finally {
  await browser.close();
}
