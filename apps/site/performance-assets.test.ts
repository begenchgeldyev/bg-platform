import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentAssets, rewriteAssetUrls } from './content-assets';
import { renderComponentTemplate, renderDynamicPage, renderPage, servePublicAsset } from './site';

const ROOT = await mkdtemp(join(tmpdir(), 'bg-site-performance-assets-'));
afterAll(() => rm(ROOT, { recursive: true, force: true }));

async function inMode<T>(mode: string, run: () => Promise<T>) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = mode;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

async function assetLinks(html: string) {
  const urls: string[] = [];
  await new HTMLRewriter()
    .on('script[src], link[rel="stylesheet"]', {
      element(element) {
        urls.push(element.getAttribute('src') ?? element.getAttribute('href') ?? '');
      },
    })
    .transform(new Response(html))
    .text();
  return urls;
}

describe('route-scoped deferred htmx', () => {
  test.each(['development', 'production'])('%s routes in both languages', async (mode) => {
    await inMode(mode, async () => {
      for (const lang of ['en', 'ru'] as const) {
        for (const path of ['/', '/resume', '/projects', '/logs']) {
          const html = await (await renderPage(path, lang))?.text();
          const scripts = html?.match(/<script\b[^>]*src="[^"]*htmx[^"]*"[^>]*>/g) ?? [];
          if (path === '/projects' || path === '/logs') {
            expect(scripts).toHaveLength(1);
            const script = scripts[0];
            if (!script) throw new Error(`Missing htmx script on ${path}`);
            expect(script).toMatch(/\bdefer\b/);
            expect(html?.indexOf('name="htmx-config"')).toBeLessThan(html?.indexOf(script) ?? -1);
          } else {
            expect(scripts).toHaveLength(0);
          }
        }
        for (const page of ['project', 'admin'] as const) {
          const response = await renderDynamicPage(new Request('http://localhost/', { headers: { cookie: `lang=${lang}` } }), {
            page,
            title: 'Title',
            contentHtml: '<main>Body</main>',
          });
          expect(await assetLinks(await response.text())).not.toContainEqual(expect.stringContaining('htmx'));
        }
      }
    });
  });
});

describe('content-addressed assets', () => {
  test('snapshots exact bytes, rejects forged hashes and separates revisions, with bounded public-only rewriting', async () => {
    await mkdir(join(ROOT, 'vendor'), { recursive: true });
    await Bun.write(join(ROOT, 'vendor/app.js'), 'const revision = 1;');
    const first = new ContentAssets(ROOT);
    const url = await first.url('/public/vendor/app.js');
    expect(url).toMatch(/^\/public\/vendor\/app\.[a-f0-9]{64}\.js$/);
    const trusted = `<script src="/public/vendor/app.js?v=1&amp;x=2#end"></script><a href="/public/vendor/app.js">link</a><script>const text = '/public/vendor/app.js';</script><script src="https://example.com/app.js"></script>`;
    const rewritten = await rewriteAssetUrls(trusted, (path) => first.url(path));
    expect(rewritten).toContain(`src="${url}?v=1&amp;x=2#end"`);
    expect(rewritten).toContain('<a href="/public/vendor/app.js">');
    expect(rewritten).toContain("const text = '/public/vendor/app.js'");
    expect(rewritten).toContain('src="https://example.com/app.js"');
    expect(await first.url('/public/%2e%2e/server.js')).toBe('/public/%2e%2e/server.js');
    const asset = await first.get(url);
    expect(asset).not.toBeNull();
    expect(await asset?.body.text()).toBe('const revision = 1;');
    expect(await (await new ContentAssets(ROOT).get(url))?.body.text()).toBe('const revision = 1;');
    await Bun.write(join(ROOT, 'vendor/app.js'), 'const revision = 2;');
    expect(await (await first.get(url))?.body.text()).toBe('const revision = 1;');
    const second = new ContentAssets(ROOT);
    expect(await second.url('/public/vendor/app.js')).not.toBe(url);
    expect(await second.get(url)).toBeNull();
    expect(await first.get(url.replace(/[a-f0-9]{64}/, '0'.repeat(64)))).toBeNull();
  });

  test('production CSS/JS links resolve to immutable bytes with an explicit fallback for unbuilt Tailwind', async () => {
    const hasTailwind = await Bun.file(join(import.meta.dir, 'public/assets/tailwind.css')).exists();
    await inMode('production', async () => {
      for (const lang of ['en', 'ru'] as const) {
        for (const path of ['/', '/resume', '/projects', '/logs']) {
          const html = await (await renderPage(path, lang))?.text();
          const urls = await assetLinks(html ?? '');
          expect(urls.length).toBeGreaterThan(2);
          expect(urls.filter((url) => /\/tailwind(?:\.[a-f0-9]{64})?\.css$/.test(url))).toHaveLength(1);
          for (const url of urls) {
            if (!hasTailwind && url === '/public/assets/tailwind.css') {
              const missing = await servePublicAsset(url);
              expect(missing.status).toBe(404);
              expect(missing.headers.get('cache-control') ?? '').not.toContain('immutable');
              continue;
            }
            expect(url).toMatch(/\.[a-f0-9]{64}\.(?:css|js)$/);
            if (!url.startsWith('/public/')) continue;
            const response = await servePublicAsset(url);
            expect(response.status).toBe(200);
            expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
            const bytes = new Uint8Array(await response.arrayBuffer());
            const digest = url.match(/\.([a-f0-9]{64})\./)?.[1];
            if (!digest) throw new Error(`Missing content hash in ${url}`);
            expect(new Bun.CryptoHasher('sha256').update(bytes).digest('hex')).toBe(digest);
            const stable = url.replace(/\.[a-f0-9]{64}(?=\.(css|js)$)/, '');
            const alias = await servePublicAsset(stable);
            expect(alias.headers.get('cache-control')).toBe('no-cache');
            expect(new Uint8Array(await alias.arrayBuffer())).toEqual(bytes);
            for (const method of ['GET', 'HEAD']) {
              const req = (headers: Record<string, string>) => new Request(`http://localhost${url}`, { method, headers });
              const cached = await servePublicAsset(url, req({ 'if-none-match': response.headers.get('etag') ?? '' }));
              expect(cached.status).toBe(304);
              expect(cached.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
              expect(await cached.text()).toBe('');
              const partial = await servePublicAsset(url, req({ range: 'bytes=0-9' }));
              expect(partial.status).toBe(206);
              expect(partial.headers.get('content-range')).toBe(`bytes 0-9/${bytes.length}`);
              expect(new Uint8Array(await partial.arrayBuffer())).toEqual(method === 'HEAD' ? new Uint8Array() : bytes.slice(0, 10));
              const invalid = await servePublicAsset(url, req({ range: 'bytes=999999999-' }));
              expect(invalid.status).toBe(416);
              expect(await invalid.text()).toBe('');
            }
            const head = await servePublicAsset(url, new Request(`http://localhost${url}`, { method: 'HEAD' }));
            expect(head.headers.get('content-length')).toBe(String(bytes.length));
            expect(await head.text()).toBe('');
            const forged = await servePublicAsset(
              url.replace(/[a-f0-9]{64}/, '0'.repeat(64)),
              new Request(`http://localhost${url}`, { headers: { 'if-none-match': '*' } }),
            );
            expect(forged.status).toBe(404);
            expect(forged.headers.get('cache-control') ?? '').not.toContain('immutable');
          }
        }
      }
    });
  });

  test('does not rewrite trusted dynamic project bodies but hashes shared chrome and component templates', async () => {
    await inMode('production', async () => {
      const body = '<main><script src="/public/hero-role.js"></script><a href="/public/assets/tailwind.css">body</a></main>';
      for (const page of ['project', 'admin'] as const) {
        const response = await renderDynamicPage(new Request('http://localhost/'), { page, title: 'Title', contentHtml: body });
        const html = await response.text();
        expect(html).toContain(body);
        expect(html).toMatch(/src="\/public\/email-copy\.[a-f0-9]{64}\.js"/);
      }
      for (const component of ['admin/script.html', 'projects/editor-script.html', 'projects/image-motion.html']) {
        expect(await renderComponentTemplate(component)).toMatch(/src="\/public\/[\w-]+\.[a-f0-9]{64}\.js"/);
      }
    });
  });

  test('development uses stable URLs and reads hot edits', async () => {
    await inMode('development', async () => {
      const html = await (await renderPage('/', 'en'))?.text();
      expect(await assetLinks(html ?? '')).toContain('/public/shared.css');
      expect(await assetLinks(html ?? '')).toContain('/assets/ask-chat.js');
      expect(html).not.toMatch(/\.[a-f0-9]{64}\.(css|js)/);
      const path = '/public/performance-test-hot.js';
      const file = join(import.meta.dir, 'public/performance-test-hot.js');
      try {
        await Bun.write(file, 'one');
        expect(await (await servePublicAsset(path)).text()).toBe('one');
        await Bun.write(file, 'two');
        expect(await (await servePublicAsset(path)).text()).toBe('two');
      } finally {
        await rm(file, { force: true });
      }
    });
  });

  test('a production file edit cannot change bytes behind a previously served hash', async () => {
    await inMode('production', async () => {
      const file = join(import.meta.dir, 'public/performance-test-revision.js');
      const first = 'const revision = 1;';
      const second = 'const revision = 2;';
      const url = `/public/performance-test-revision.${new Bun.CryptoHasher('sha256').update(first).digest('hex')}.js`;
      try {
        await Bun.write(file, first);
        expect(await (await servePublicAsset(url)).text()).toBe(first);
        await Bun.write(file, second);
        expect(await (await servePublicAsset(url)).text()).toBe(first);
        const stable = await servePublicAsset('/public/performance-test-revision.js');
        expect(stable.headers.get('cache-control')).toBe('no-cache');
        expect(await stable.text()).toBe(second);
      } finally {
        await rm(file, { force: true });
      }
    });
  });

  test('shared stylesheet follows Tailwind and precedes page-specific styles', async () => {
    const html = await (await renderPage('/projects', 'en'))?.text();
    const urls = await assetLinks(html ?? '');
    const tailwind = urls.findIndex((url) => url.includes('/tailwind.'));
    const shared = urls.findIndex((url) => url.includes('/shared.'));
    expect(tailwind).toBeGreaterThan(-1);
    expect(shared).toBe(tailwind + 1);
    expect(html).not.toContain('@font-face');
    expect(html?.indexOf('/shared.')).toBeLessThan(html?.indexOf('.project-gallery') ?? -1);
    const css = await Bun.file(join(import.meta.dir, 'public/shared.css')).text();
    for (const family of ['"OpenTUI Mono"', '"Noto Sans Mono"', '"Material Symbols Outlined"']) {
      expect(css).toContain(`font-family: ${family}`);
    }
    expect(css).toContain('font-family: "OpenTUI Mono", "Noto Sans Mono", SFMono-Regular');
  });
});
