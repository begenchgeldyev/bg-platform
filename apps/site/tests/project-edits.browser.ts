// Self-contained controller fixtures: no production server, database, or model calls.
// PLAYWRIGHT_MODULE=/existing/playwright/index.mjs bun apps/site/tests/project-edits.browser.ts
import assert from 'node:assert/strict';
import type { Project } from '@bg/core';
import { AdminController } from '../admin/admin.controller';
import { ProjectController, type ProjectControllerRepository } from '../project/project.controller';
import { PROJECT_LIMITS } from '../project/project-input';
import { servePublicAsset } from '../site';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.EVIDENCE_DIR || '.slim/deepwork/codebase-deepening/task-1-browser';
const initial: Project = {
  id: 7,
  name: 'Demo',
  description: 'Saved description',
  content: '<p>Saved content</p>',
  image: null,
  isHidden: false,
  icon: 'database',
  tags: ['Bun'],
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};
const projects = [initial, { ...initial, id: 8, name: 'Other' }];
const repository: ProjectControllerRepository = {
  list: async ({ includeHidden }) => projects.filter((project) => includeHidden || !project.isHidden),
  findById: async (id) => projects.find((project) => project.id === id) ?? null,
  async create(input) {
    const project = { ...initial, ...input, id: Math.max(...projects.map((project) => project.id)) + 1 };
    projects.push(project);
    return project;
  },
  async updateById(id, changes) {
    const project = projects.find((project) => project.id === id);
    return project ? Object.assign(project, changes, { updatedAt: new Date() }) : null;
  },
  async deleteById(id) {
    const index = projects.findIndex((project) => project.id === id);
    if (index < 0) return false;
    projects.splice(index, 1);
    return true;
  },
};
const admin = new AdminController({
  projectsRepository: repository,
  projectAccess: async () => 'editor',
});
const project = new ProjectController(repository, async () => 'editor');
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/admin') return admin.page(req);
    if (path === '/projects/7') return project.getPageById(req, 7);
    if (path.startsWith('/public/')) return (await servePublicAsset(path)) || new Response(null, { status: 404 });
    return new Response(null, { status: 404 });
  },
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
const checks: { name: string; passed: boolean; error?: string }[] = [];
const failures: string[] = [];
type Page = Awaited<ReturnType<typeof browser.newPage>>;
type Route = Parameters<Parameters<Page['route']>[1]>[0];
const image = {
  name: 'image.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64'),
};

async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    checks.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = String(error);
    failures.push(`${name}: ${message}`);
    checks.push({ name, passed: false, error: message });
    console.log(`FAIL ${name}: ${message}`);
  }
}

async function fixture(surface: 'admin' | 'inline') {
  const page = await browser.newPage({ baseURL: server.url.toString(), viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(4000);
  await page.route('**/*', (route: Route) =>
    new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort(),
  );
  const errors: string[] = [];
  page.on('pageerror', (error: Error) => {
    errors.push(error.message);
    console.log(`PAGEERROR ${surface}: ${error.message}`);
  });
  const requests: { method: string; body: Record<string, unknown> | null }[] = [];
  let handler = (route: Route) => route.fulfill({ status: 200, json: { project: initial } });
  await page.route('**/api/projects**', async (route: Route) => {
    requests.push({ method: route.request().method(), body: route.request().postDataJSON() });
    await handler(route);
  });
  await page.goto(surface === 'admin' ? '/admin' : '/projects/7', { waitUntil: 'load' });
  return {
    page,
    requests,
    errors,
    handle(next: typeof handler) {
      handler = next;
    },
  };
}

async function status(page: Page, surface: 'admin' | 'inline', text: string) {
  await page.waitForFunction(({ id, text }) => document.getElementById(id)?.textContent?.includes(text), {
    id: surface === 'admin' ? 'admin-editor-status' : 'project-admin-status',
    text,
  });
}

try {
  for (const mode of ['network', 'malformed', 'http']) {
    await check(`inline ${mode} save failure keeps draft/focus and Enter retries once`, async () => {
      const f = await fixture('inline');
      try {
        f.handle((route) =>
          mode === 'network'
            ? route.abort('failed')
            : route.fulfill({
                status: mode === 'http' ? 403 : 200,
                contentType: 'application/json',
                body: mode === 'http' ? '{"error":"no"}' : '{}',
              }),
        );
        const title = f.page.locator('[data-project-field="name"]');
        await title.dblclick();
        await title.fill(' Draft ');
        const draft = await title.textContent();
        await title.press('Enter');
        await f.page.waitForFunction(() =>
          /failed|unable|invalid|error|^no$/i.test(document.getElementById('project-admin-status')?.textContent || ''),
        );
        assert.equal(await title.textContent(), draft);
        assert.equal(await title.getAttribute('contenteditable'), 'true');
        assert.equal(await title.evaluate((node) => document.activeElement === node), true);
        f.handle((route) => route.fulfill({ status: 200, json: { project: { ...initial, name: 'Normalized' } } }));
        await Promise.all([f.page.waitForEvent('load'), title.press('Enter')]);
        assert.equal(f.requests.length, 2);
        assert.deepEqual(f.requests[1]?.body, { name: 'Draft' });
        assert.deepEqual(f.errors, []);
      } finally {
        await f.page.close();
      }
    });

    await check(`inline ${mode} hide and image rollback preserve unrelated unsaved content`, async () => {
      const f = await fixture('inline');
      try {
        f.handle((route) =>
          mode === 'network' ? route.abort('failed') : route.fulfill({ status: mode === 'http' ? 403 : 200, json: {} }),
        );
        const content = f.page.locator('[data-project-field="content"]');
        await content.dblclick();
        await content.fill('Unsaved body');
        await f.page.locator('#project-visibility-toggle').click();
        await f.page.waitForFunction(() =>
          /failed|unable|invalid|error|^no$/i.test(document.getElementById('project-admin-status')?.textContent || ''),
        );
        assert.equal(await f.page.locator('[data-project-visibility]').textContent(), 'Published');
        assert.equal(await content.textContent(), 'Unsaved body');
        assert.deepEqual(f.requests[0]?.body, { isHidden: true });
        await f.page.locator('#project-upload-input').setInputFiles(image);
        await f.page.waitForFunction(() =>
          /failed|unable|invalid|error|^no$/i.test(document.getElementById('project-admin-status')?.textContent || ''),
        );
        assert.equal(await f.page.locator('[data-project-preview]').getAttribute('src'), '');
        assert.equal(await content.textContent(), 'Unsaved body');
        assert.deepEqual(Object.keys(f.requests[1]?.body || {}), ['image']);
        f.handle((route) => route.fulfill({ status: 200, json: { project: { ...initial, isHidden: true } } }));
        await f.page.locator('#project-visibility-toggle').focus();
        await f.page.keyboard.press('Space');
        await status(f.page, 'inline', 'Project hidden.');
        assert.equal(f.requests.length, 3);
        assert.equal(await content.textContent(), 'Unsaved body');
        await content.press('Escape');
        assert.equal(await content.innerHTML(), '<p>Saved content</p>');
        assert.equal(await f.page.locator('[data-project-visibility]').textContent(), 'Hidden');
        f.handle((route) =>
          route.fulfill({ status: 200, json: { project: { ...initial, isHidden: true, image: f.requests.at(-1)?.body?.image } } }),
        );
        await f.page.locator('#project-upload-input').setInputFiles(image);
        await status(f.page, 'inline', 'Image updated.');
        assert.equal(f.requests.length, 4);
        assert.deepEqual(Object.keys(f.requests[3]?.body || {}), ['image']);
        assert.ok((await f.page.locator('[data-project-preview]').getAttribute('src'))?.startsWith('data:'));
        assert.deepEqual(f.errors, []);
      } finally {
        await f.page.close();
      }
    });

    await check(`admin ${mode} failure releases controls and keyboard retry commits normalized project`, async () => {
      const f = await fixture('admin');
      try {
        f.handle((route) =>
          mode === 'network' ? route.abort('failed') : route.fulfill({ status: mode === 'http' ? 403 : 200, json: {} }),
        );
        await f.page.locator('#admin-form-name').fill('Draft');
        await f.page.locator('#admin-save-btn').click();
        await f.page.waitForFunction(() =>
          /failed|unable|invalid|error|^no$/i.test(document.getElementById('admin-editor-status')?.textContent || ''),
        );
        assert.equal(await f.page.locator('#admin-save-btn').isEnabled(), true);
        f.handle((route) => route.fulfill({ status: 200, json: { project: { ...initial, name: 'Normalized' } } }));
        await f.page.locator('#admin-save-btn').focus();
        await f.page.keyboard.press('Enter');
        await status(f.page, 'admin', 'saved successfully');
        assert.equal(await f.page.locator('#admin-form-name').inputValue(), 'Normalized');
        assert.equal(f.requests.length, 2);
        assert.deepEqual(f.errors, []);
      } finally {
        await f.page.close();
      }
    });
  }

  for (const surface of ['admin', 'inline'] as const) {
    await check(`${surface} rejects oversized images before FileReader`, async () => {
      const f = await fixture(surface);
      try {
        await f.page.evaluate(() => {
          window.FileReader = class {
            constructor() {
              throw new Error('Oversized image was read');
            }
          } as unknown as typeof FileReader;
        });
        await f.page
          .locator(surface === 'admin' ? '#admin-photo-input' : '#project-upload-input')
          .setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(PROJECT_LIMITS.maxImageBytes + 1) });
        await status(f.page, surface, 'before reading');
        assert.equal(f.requests.length, 0);
        assert.deepEqual(f.errors, []);
      } finally {
        await f.page.close();
      }
    });
  }

  await check('admin image stays a draft; read reserves selection/save/reset and subsequent save persists it once', async () => {
    const f = await fixture('admin');
    try {
      await f.page.evaluate(() => {
        const Reader = window.FileReader;
        window.FileReader = class extends Reader {
          readAsDataURL(file: Blob) {
            setTimeout(() => super.readAsDataURL(file), 350);
          }
        };
      });
      await f.page.locator('#admin-photo-input').setInputFiles(image);
      await f.page.locator('#admin-save-btn').dispatchEvent('click', { detail: 0 });
      await f.page.locator('#admin-new-project-btn').dispatchEvent('click', { detail: 0 });
      await f.page.locator('#admin-reset-btn').dispatchEvent('click', { detail: 0 });
      await f.page.locator('[data-project-id="8"]').dispatchEvent('click', { detail: 0 });
      await f.page.waitForFunction(() =>
        document.querySelector<HTMLImageElement>('#admin-photo-preview-img')?.getAttribute('src')?.startsWith('data:'),
      );
      assert.equal(f.requests.length, 0);
      assert.equal(await f.page.locator('#admin-form-name').inputValue(), 'Demo');
      f.handle((route) => route.fulfill({ status: 200, json: { project: { ...initial, image: f.requests.at(-1)?.body?.image } } }));
      await f.page.locator('#admin-save-btn').click();
      await status(f.page, 'admin', 'saved successfully');
      assert.equal(f.requests.length, 1);
      assert.ok(String(f.requests[0]?.body?.image).startsWith('data:image/png;base64,'));
      assert.deepEqual(f.errors, []);
    } finally {
      await f.page.close();
    }
  });

  await check('inline image reservation covers reading and PATCH; hide/save overlaps cannot persist stale data', async () => {
    const f = await fixture('inline');
    try {
      await f.page.evaluate(() => {
        const Reader = window.FileReader;
        window.FileReader = class extends Reader {
          readAsDataURL(file: Blob) {
            setTimeout(() => super.readAsDataURL(file), 350);
          }
        };
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.handle(async (route) => {
        await gate;
        await route.fulfill({ status: 200, json: { project: { ...initial, image: f.requests[0]?.body?.image } } });
      });
      const content = f.page.locator('[data-project-field="content"]');
      await content.dblclick();
      await content.fill('Unsaved body');
      await f.page.locator('#project-upload-input').setInputFiles(image);
      await f.page.locator('#project-visibility-toggle').click();
      await content.press('Enter');
      await f.page.waitForTimeout(450);
      assert.equal(f.requests.length, 1);
      assert.deepEqual(Object.keys(f.requests[0]?.body || {}), ['image']);
      await f.page.locator('#project-visibility-toggle').focus();
      await f.page.keyboard.press('Enter');
      assert.equal(f.requests.length, 1);
      release();
      await status(f.page, 'inline', 'Image updated.');
      assert.equal(await content.textContent(), 'Unsaved body');
      assert.equal(await f.page.locator('[data-project-visibility]').textContent(), 'Published');
      await content.press('Escape');
      assert.ok((await f.page.locator('[data-project-preview]').getAttribute('src'))?.startsWith('data:'));
      assert.deepEqual(f.errors, []);
    } finally {
      await f.page.close();
    }
  });

  await check('inline pending hide rejects repeated pointer/keyboard, image and text save; server normalization wins', async () => {
    const f = await fixture('inline');
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.handle(async (route) => {
        await gate;
        await route.fulfill({ status: 200, json: { project: initial } });
      });
      const content = f.page.locator('[data-project-field="content"]');
      await content.dblclick();
      await content.fill('Unsaved body');
      await f.page.locator('#project-visibility-toggle').click();
      await f.page.locator('#project-visibility-toggle').focus();
      await f.page.keyboard.press('Enter');
      await f.page.locator('#project-upload-input').setInputFiles(image);
      await content.press('Enter');
      assert.equal(f.requests.length, 1);
      assert.deepEqual(f.requests[0]?.body, { isHidden: true });
      release();
      await status(f.page, 'inline', 'Project published.');
      assert.equal(await f.page.locator('[data-project-visibility]').textContent(), 'Published');
      assert.equal(await content.textContent(), 'Unsaved body');
      assert.deepEqual(f.errors, []);
    } finally {
      await f.page.close();
    }
  });

  await check('inline image read failure releases reservation and retry persists only image', async () => {
    const f = await fixture('inline');
    try {
      await f.page.evaluate(() => {
        const Reader = window.FileReader;
        let failed = false;
        window.FileReader = class extends Reader {
          readAsDataURL(file: Blob) {
            if (!failed) {
              failed = true;
              this.dispatchEvent(new Event('error'));
            } else super.readAsDataURL(file);
          }
        };
      });
      await f.page.locator('#project-upload-input').setInputFiles(image);
      await status(f.page, 'inline', 'Failed to read image');
      assert.equal(f.requests.length, 0);
      f.handle((route) => route.fulfill({ status: 200, json: { project: { ...initial, image: f.requests.at(-1)?.body?.image } } }));
      await f.page.locator('#project-upload-input').setInputFiles(image);
      await status(f.page, 'inline', 'Image updated.');
      assert.equal(f.requests.length, 1);
      assert.deepEqual(Object.keys(f.requests[0]?.body || {}), ['image']);
      assert.deepEqual(f.errors, []);
    } finally {
      await f.page.close();
    }
  });

  await Bun.write(
    `${output}/results.json`,
    JSON.stringify(
      {
        checks,
        failures,
        fixture: 'production AdminController/ProjectController rendered HTML; local intercepted writes',
        chromium: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      },
      null,
      2,
    ),
  );
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  server.stop(true);
}
