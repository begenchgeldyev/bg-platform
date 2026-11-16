// Local SSR fixtures only. API writes are intercepted in-memory; no database or AI.
// PLAYWRIGHT_MODULE=/existing/playwright/index.mjs CHROMIUM_PATH=/usr/bin/google-chrome bun apps/site/tests/ui-refinements.browser.ts
import assert from 'node:assert/strict';
import type { Project } from '@bg/core';
import { AdminController } from '../admin/admin.controller';
import { ProjectController, type ProjectControllerRepository } from '../project/project.controller';
import { renderPage, servePublicAsset } from '../site';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base: Project = {
  id: 1,
  name: 'PaNtHeOn ЁЖ',
  description: 'A project with optional destinations.',
  content: '<p>Project content.</p>',
  image: null,
  icon: null,
  tags: [],
  isHidden: false,
  githubUrl: 'https://github.com/example/project',
  liveUrl: 'https://example.com/app?x=1&y=2',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};
const projects = [
  base,
  { ...base, id: 2, githubUrl: null, liveUrl: null },
  { ...base, id: 3, liveUrl: null },
  { ...base, id: 4, githubUrl: null },
];
const refuse = async (): Promise<never> => {
  throw new Error('Fixture writes must be intercepted');
};
const repository: ProjectControllerRepository = {
  list: async () => projects,
  findById: async (id) => projects.find((project) => project.id === id) ?? null,
  create: refuse,
  updateById: refuse,
  deleteById: refuse,
};
const visitor = new ProjectController(repository, async () => 'visitor');
const owner = new ProjectController(repository, async () => 'editor');
const admin = new AdminController({ projectsRepository: repository, projectAccess: async () => 'editor' });
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method !== 'GET') return new Response(null, { status: 405 });
    if (url.pathname.startsWith('/public/')) return servePublicAsset(url.pathname);
    if (url.pathname === '/admin') return admin.page(req);
    if (url.pathname.startsWith('/projects/'))
      return (url.searchParams.has('owner') ? owner : visitor).getPageById(req, Number(url.pathname.split('/').at(-1)));
    const lang = req.headers.get('cookie')?.includes('lang=ru') ? 'ru' : 'en';
    if (url.pathname === '/fixture-footer') {
      const response = await renderPage('/', lang);
      assert.ok(response);
      const html = await response.text();
      return new Response(`${html.match(/<footer\b[\s\S]*?<\/footer>/)?.[0]}<script src="/public/email-copy.js"></script>`, {
        headers: { 'Content-Type': 'text/html' },
      });
    }
    return (await renderPage(url.pathname, lang)) ?? new Response(null, { status: 404 });
  },
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
try {
  for (const lang of ['en', 'ru']) {
    for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({
        baseURL: server.url.toString(),
        viewport: { width, height: 1000 },
        hasTouch: width < 500,
      });
      try {
        await context.addCookies([{ name: 'lang', value: lang, url: server.url.toString() }]);
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        await page.route('**/*', (route) =>
          new URL(route.request().url()).origin === server.url.origin && !route.request().url().includes('/api/ask')
            ? route.continue()
            : route.abort(),
        );
        await page.addInitScript(() => {
          Object.assign(window, { copyWrites: [], copyMode: 'success' });
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
              writeText: async (value: string) => {
                const state = window as unknown as { copyMode: string; copyWrites: string[] };
                if (state.copyMode === 'denied') throw new Error('denied');
                state.copyWrites.push(value);
              },
            },
          });
        });
        await page.goto('/');
        assert.equal(await page.locator('#terminal-wrap').getByText('stack:', { exact: true }).count(), 0);
        const button = page.locator('[data-copy-email]');
        const status = page.locator('#email-copy-status');
        await button.scrollIntoViewIfNeeded();
        const before = await button.boundingBox();
        await button.click();
        await page.waitForFunction(() => document.getElementById('email-copy-status')?.textContent);
        assert.equal(await status.textContent(), lang === 'ru' ? 'Скопировано' : 'Copied');
        assert.deepEqual(await button.boundingBox(), before, 'confirmation never moves the button');
        await button.focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Space');
        if (width < 500) await button.tap();
        const count = width < 500 ? 4 : 3;
        assert.equal(await page.evaluate(() => (window as unknown as { copyWrites: string[] }).copyWrites.length), count);
        // Real HTMX replacement, including reexecution of the external copy script.
        await page.evaluate(async () => {
          await (window as unknown as { htmx: { ajax: (method: string, url: string, options: object) => Promise<void> } }).htmx.ajax(
            'GET',
            '/fixture-footer',
            { target: 'footer', swap: 'outerHTML' },
          );
        });
        await page.locator('[data-copy-email]').click();
        assert.equal(await page.evaluate(() => (window as unknown as { copyWrites: string[] }).copyWrites.length), count + 1);
        await page.evaluate(() => {
          (window as unknown as { copyMode: string }).copyMode = 'denied';
        });
        await page.locator('[data-copy-email]').click();
        assert.match((await status.textContent()) ?? '', lang === 'ru' ? /Не удалось/ : /Could not copy/);
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
        await page.locator('[data-copy-email]').focus();
        await page.keyboard.press('Enter');
        assert.match((await status.textContent()) ?? '', lang === 'ru' ? /Выделите/ : /Select and copy/);
        for (const id of [1, 2, 3, 4]) {
          await page.goto(`/projects/${id}`);
          const links = page.locator('[data-project-links] a');
          assert.equal(await links.count(), id === 1 ? 2 : id === 2 ? 0 : 1);
          assert.equal(await page.locator('main aside').count(), id === 2 ? 0 : 1);
          assert.equal(await page.getByText('[METADATA]', { exact: true }).count(), 0);
          for (const link of await links.all()) {
            assert.equal(await link.getAttribute('target'), '_blank');
            assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          if (id === 2 && width === 1440) {
            const grid = await page.locator('main > section').boundingBox();
            const content = await page.locator('main > section > div').boundingBox();
            assert.ok(grid && content && Math.abs(grid.width - content.width) < 1, 'no empty sidebar column');
          }
        }
        await page.goto('/projects/2?owner');
        assert.equal(await page.locator('#project-visibility-toggle').count(), 1);
        assert.equal(await page.locator('#project-upload-trigger').count(), 1);
        assert.equal(await page.locator('[data-project-links]').count(), 0);
        console.log(
          `PASS ${lang}/${width}: copy mouse/keyboard/touch, denial/unavailable, HTMX; links both/neither/single, owner controls`,
        );
      } finally {
        await context.close();
      }
    }
  }

  const page = await browser.newPage({ baseURL: server.url.toString() });
  try {
    await page.route('**/*', (route) => (new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort()));
    const saves: Record<string, unknown>[] = [];
    await page.route('**/api/projects**', async (route) => {
      const payload = route.request().postDataJSON();
      saves.push(payload);
      await route.fulfill({ status: 200, json: { project: { ...base, ...payload } } });
    });
    await page.goto('/admin');
    const github = page.locator('#admin-form-github-url');
    const live = page.locator('#admin-form-live-url');
    const save = page.locator('#admin-save-btn');
    assert.equal(await github.inputValue(), base.githubUrl);
    assert.equal(await live.inputValue(), base.liveUrl);
    assert.equal((await page.locator('#admin-view-live-link span').first().textContent())?.trim(), 'View project page');
    for (const bad of [
      'https://github.com/owner',
      'http://github.com/owner/repo',
      'https://user:pass@github.com/owner/repo',
      'https://github.com/owner/repo/..',
      'https://github.com/owner/repo%0a',
    ]) {
      await github.fill(bad);
      await save.click();
      assert.equal(saves.length, 0);
      assert.equal(await github.evaluate((input: HTMLInputElement) => input.validity.valid), false);
      assert.ok(await page.locator('#admin-editor-status').textContent());
    }
    await page.locator('#admin-reset-btn').click();
    assert.equal(await github.inputValue(), base.githubUrl);
    assert.equal(await github.evaluate((input: HTMLInputElement) => input.validity.valid), true);
    await live.fill('javascript:alert(1)');
    await save.click();
    assert.equal(saves.length, 0);
    for (const bad of ['https://example.com/%80', 'https://example.com/%C2%80']) {
      await live.fill(bad);
      await save.click();
      assert.equal(saves.length, 0, `encoded control/invalid UTF-8 must not save: ${bad}`);
      assert.equal(await live.evaluate((input: HTMLInputElement) => input.validity.valid), false);
      assert.ok(await page.locator('#admin-editor-status').textContent());
    }
    await github.fill(' https://github.com/example/changed ');
    await live.fill(' http://localhost:3000/app ');
    await save.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('admin-editor-status')?.textContent?.includes('saved successfully'));
    assert.equal(saves.length, 1);
    assert.equal(saves[0].githubUrl, 'https://github.com/example/changed');
    assert.equal(saves[0].liveUrl, 'http://localhost:3000/app');
    const cyrillicUrl = 'https://example.com/%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82';
    await live.fill(cyrillicUrl);
    await save.click();
    await page.waitForFunction(() => document.getElementById('admin-editor-status')?.textContent?.includes('saved successfully'));
    assert.equal(saves[1].liveUrl, cyrillicUrl, 'valid encoded Cyrillic is saved without decoding or normalization');
    await github.fill('');
    await live.fill('');
    await save.click();
    await page.waitForFunction(() => document.getElementById('admin-editor-status')?.textContent?.includes('saved successfully'));
    assert.equal(saves[2].githubUrl, null);
    assert.equal(saves[2].liveUrl, null);
    await page.locator('#admin-new-project-btn').click();
    assert.equal(await github.inputValue(), '');
    assert.equal(await live.inputValue(), '');
    console.log(
      'PASS Admin: hydrated URLs, explicit validity including encoded controls/UTF-8 and valid Cyrillic, reset, keyboard save, trimmed values, clearing and new defaults',
    );
  } finally {
    await page.close();
  }
} finally {
  await browser.close();
  server.stop(true);
}
