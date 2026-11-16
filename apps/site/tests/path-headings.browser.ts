// Self-contained real SSR/editor fixtures: no production, database, Admin or AI requests.
// PLAYWRIGHT_MODULE=/existing/playwright/index.mjs CHROMIUM_PATH=/usr/bin/google-chrome bun apps/site/tests/path-headings.browser.ts
// Build existing styles first: bun run --cwd apps/site css:build
import assert from 'node:assert/strict';
import type { Project } from '@bg/core';
import { ProjectController, type ProjectControllerRepository } from '../project/project.controller';
import { renderPage, servePublicAsset } from '../site';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ordinaryName = 'MiXeD ПроЕкт ЁЖ — v2.0';
const projects: Project[] = [ordinaryName, 'X'.repeat(120)].map((name, index) => ({
  id: index + 1,
  name,
  description: 'Preserved description.',
  content: '<p>Preserved full body.</p>',
  image: null,
  githubUrl: null,
  liveUrl: null,
  isHidden: false,
  icon: 'database',
  tags: ['Bun'],
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}));
const repository: ProjectControllerRepository = {
  list: async () => projects,
  findById: async (id) => projects.find((project) => project.id === id) ?? null,
  create: async () => {
    throw new Error('Fixture writes must be intercepted');
  },
  updateById: async () => {
    throw new Error('Fixture writes must be intercepted');
  },
  deleteById: async () => {
    throw new Error('Fixture writes must be intercepted');
  },
};
const controller = new ProjectController(repository, async () => 'editor');
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (req.method !== 'GET') return new Response(null, { status: 405 });
    if (path.startsWith('/public/')) return servePublicAsset(path);
    if (path === '/api/projects') return controller.get(req);
    if (path === '/api/logs') return new Response(null, { status: 404 });
    if (path === '/projects/1' || path === '/projects/2') return controller.getPageById(req, Number(path.at(-1)));
    const lang = req.headers.get('cookie')?.includes('lang=ru') ? 'ru' : 'en';
    return (await renderPage(path, lang)) ?? new Response(null, { status: 404 });
  },
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
  type Page = Awaited<ReturnType<typeof browser.newPage>>;
  type Route = Parameters<Parameters<Page['route']>[1]>[0];
  for (const lang of ['en', 'ru'] as const) {
    for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({ baseURL: server.url.toString(), viewport: { width, height: 1000 } });
      try {
        await context.addCookies([{ name: 'lang', value: lang, url: server.url.toString() }]);
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        await page.route('**/*', (route: Route) =>
          new URL(route.request().url()).origin === server.url.origin && !route.request().url().includes('/api/ask')
            ? route.continue()
            : route.abort(),
        );
        let baseline: { x: number; y: number; width: number } | undefined;
        for (const path of ['/projects', '/logs', '/resume', '/projects/1', '/projects/2']) {
          await page.goto(path, { waitUntil: 'load' });
          await page.evaluate(() => document.fonts.ready);
          const heading = page.getByRole('heading', { level: 1 });
          const name =
            path === '/projects'
              ? lang === 'en'
                ? 'projects'
                : 'проекты'
              : path === '/projects/1'
                ? ordinaryName
                : path === '/projects/2'
                  ? 'X'.repeat(120)
                  : path.slice(1);
          assert.equal(await heading.count(), 1);
          assert.equal(await heading.textContent(), name, 'H1 contains only the exact name');
          const header = page.locator('main > header');
          const box = await header.boundingBox();
          assert.ok(box);
          if (!baseline) baseline = { x: box.x, y: box.y, width: box.width };
          assert.deepEqual(
            { x: box.x, y: box.y, width: box.width },
            baseline,
            'all headings match Projects gutters, top spacing and full width',
          );
          assert.equal(box.x, width < 640 ? 20 : (width - 1152) / 2 + 32);
          const styles = await header.evaluate((node: Element) => {
            const css = getComputedStyle(node);
            return {
              size: css.fontSize,
              border: css.borderBottomWidth,
              color: css.color,
              padding: css.paddingBottom,
              margin: css.marginBottom,
            };
          });
          assert.deepEqual(styles, {
            size: width <= 600 ? '21px' : '24px',
            border: '1px',
            color: 'rgb(242, 241, 240)',
            padding: width <= 600 ? '18px' : '22px',
            margin: width <= 600 ? '24px' : '28px',
          });
          const prefix = header.locator(path === '/resume' ? '.resume-heading > span' : ':scope > span').first();
          assert.equal(await prefix.textContent(), path.startsWith('/projects/') ? '~/project/' : '~/');
          assert.equal(await prefix.getAttribute('aria-hidden'), 'true');
          assert.equal(
            await prefix.evaluate((node: Element) => getComputedStyle(node).color),
            path.startsWith('/projects/') ? 'rgb(242, 241, 240)' : 'rgb(0, 255, 65)',
          );
          const cursor = header.locator('.projects-header-cursor');
          const spacing = await heading.evaluate((node: Element) => {
            const prefix = node.previousElementSibling?.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(node);
            const lines = [...range.getClientRects()];
            const last = lines.at(-1);
            const cursor = node.nextElementSibling;
            return {
              prefixRight: prefix?.right,
              prefixTop: prefix?.top,
              firstLeft: lines[0]?.left,
              firstTop: lines[0]?.top,
              lineStart: node.closest('header')?.getBoundingClientRect().left,
              cursorMargin: cursor && getComputedStyle(cursor).marginLeft,
              cursorGap: cursor && last ? cursor.getBoundingClientRect().left - last.right : null,
              sameLine: cursor && last ? Math.abs(cursor.getBoundingClientRect().top - last.top) < 12 : false,
            };
          });
          assert.ok(spacing.prefixRight !== undefined && spacing.firstLeft !== undefined);
          if (spacing.firstTop !== undefined && spacing.prefixTop !== undefined && spacing.firstTop > spacing.prefixTop + 12) {
            assert.ok(
              spacing.lineStart !== undefined && Math.abs(spacing.firstLeft - spacing.lineStart) < 1,
              'wrapped name starts at the line edge without added indentation',
            );
          } else {
            assert.ok(Math.abs(spacing.firstLeft - spacing.prefixRight) < 1, `${path}: prefix and name have no layout gap`);
          }
          assert.equal(spacing.cursorMargin, '8px', `${path}: cursor retains its explicit 8px separation`);
          if (spacing.sameLine)
            assert.ok(spacing.cursorGap !== null && Math.abs(spacing.cursorGap - 8) < 1, `${path}: rendered cursor gap is 8px`);
          assert.equal(await cursor.getAttribute('aria-hidden'), 'true');
          assert.deepEqual(
            await cursor.evaluate((node: Element) => {
              const css = getComputedStyle(node);
              return { duration: css.animationDuration, timing: css.animationTimingFunction, background: css.backgroundColor };
            }),
            { duration: '2s', timing: 'steps(1)', background: 'rgb(0, 255, 65)' },
          );
          // Sample animation phases deterministically, rather than waiting through every cycle.
          assert.deepEqual(
            await cursor.evaluate((node: Element) => {
              const animation = node.getAnimations()[0];
              animation.pause();
              return [0, 999, 1001, 1999, 2001].map((time) => {
                animation.currentTime = time;
                return getComputedStyle(node).opacity;
              });
            }),
            ['1', '1', '0', '0', '1'],
          );
          await page.emulateMedia({ reducedMotion: 'reduce' });
          assert.deepEqual(
            await cursor.evaluate((node: Element) => ({
              opacity: getComputedStyle(node).opacity,
              animations: node.getAnimations().length,
            })),
            { opacity: '1', animations: 0 },
          );
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          assert.equal(await header.evaluate((node: Element) => node.scrollWidth <= node.clientWidth), true, 'heading never overflows');
          if (path === '/resume') {
            const download = page.locator('main a[download]');
            const action = await download.boundingBox();
            assert.ok(action && action.y >= box.y && action.y + action.height < box.y + box.height, 'download remains above the divider');
            const title = await header.locator('.resume-heading').boundingBox();
            assert.ok(title);
            if (width === 1440) {
              assert.ok(action.x > title.x + title.width && action.y < title.y + title.height, 'download sits beside the heading');
              assert.ok(Math.abs(action.x - title.x - title.width - 16) < 1, 'PDF action keeps its 16px gap');
            }
            assert.equal(
              (await download.textContent()).replace(/\s+/g, ' ').trim(),
              lang === 'en' ? 'download Download resume' : 'download Скачать резюме',
            );
          }
          if (path.startsWith('/projects/')) {
            const back = await page.locator('main a[href="/projects"]').boundingBox();
            const grid = await page.locator('main > section').boundingBox();
            assert.ok(back && grid && box.y + box.height < back.y && back.y < grid.y);
            assert.equal(await heading.evaluate((node: Element) => getComputedStyle(node).textTransform), 'lowercase');
            assert.equal(await heading.evaluate((node: Element) => getComputedStyle(node).color), 'rgb(242, 241, 240)');
            assert.equal(
              await heading.evaluate((node: Element) => node.previousSibling?.nodeType),
              1,
              'no whitespace node separates slash and name',
            );
            const placement = await heading.evaluate((node: Element) => {
              const range = document.createRange();
              range.selectNodeContents(node);
              const lines = [...range.getClientRects()];
              const cursor = node.nextElementSibling?.getBoundingClientRect();
              return { lines: lines.length, last: lines.at(-1)?.toJSON(), cursor: cursor?.toJSON() };
            });
            assert.ok(placement.last && placement.cursor);
            assert.ok(placement.cursor.y >= placement.last.y - 3, 'cursor follows the final text line, never the first wrapped line');
            if (path === '/projects/2' && width < 640) assert.ok(placement.lines > 1, 'unbroken name wraps fully');
            assert.equal(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
              true,
              'project has no horizontal scrolling',
            );
          }
          console.log(`PASS ${lang}/${width} ${path}: exact H1, shared geometry, cursor/reduced motion, placement/wrapping`);
        }
        await page.goto('/projects/1', { waitUntil: 'load' });
        const saved: unknown[] = [];
        await page.route('**/api/projects/1', async (route: Route) => {
          assert.equal(route.request().method(), 'PATCH');
          saved.push(route.request().postDataJSON());
          await route.fulfill({ status: 200, json: { project: { ...projects[0], name: 'Edited ЁЖ v3' } } });
        });
        const heading = page.getByRole('heading', { level: 1 });
        await heading.dblclick();
        assert.equal(await heading.getAttribute('contenteditable'), 'true');
        assert.equal(await heading.textContent(), ordinaryName);
        assert.equal(await heading.evaluate((node: Element) => getComputedStyle(node).textTransform), 'none');
        assert.equal(
          await page
            .locator('main > header > span')
            .evaluateAll((nodes: Element[]) => nodes.some((node) => (node as HTMLElement).isContentEditable)),
          false,
        );
        await heading.fill('Edited ЁЖ v3');
        await Promise.all([page.waitForEvent('load'), heading.press('Enter')]);
        assert.deepEqual(saved, [{ name: 'Edited ЁЖ v3' }], 'real editor sends name only, without prefix or cursor');
        console.log(`PASS ${lang}/${width}: isolated name-only inline save payload`);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser?.close();
  server.stop(true);
}
