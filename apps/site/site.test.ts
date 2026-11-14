import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { localizedFragmentFile } from './i18n';
import { renderPage, servePublicAsset } from './site';

const FONT_PATH = '/public/fonts/OpenTUIMono-Regular.woff2';
const SCRIPT_PATH = '/public/hero-role.js';

function withHeaders(pathname: string, headers: Record<string, string>, method = 'GET') {
  return new Request(`http://localhost${pathname}`, { headers, method });
}

describe('renderPage language selection', () => {
  test('renders the English fragment by default', async () => {
    const res = await renderPage('/cv', 'en');
    expect(res).not.toBeNull();
    const html = await (res as Response).text();
    expect(html).toContain('Experience');
  });

  test('derives the translated filename and still serves 200', async () => {
    expect(localizedFragmentFile('nonexistent.html', 'ru')).toBe('nonexistent.ru.html');

    const res = await renderPage('/cv', 'ru');
    expect((res as Response).status).toBe(200);
  });

  test('returns null for an unknown path', async () => {
    expect(await renderPage('/nope', 'en')).toBeNull();
  });

  test('sets the html lang attribute from the language', async () => {
    const res = await renderPage('/cv', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('lang="ru"');
  });
});

describe('include resolution', () => {
  test('resolves an include whose filename contains a hyphen', async () => {
    const res = await renderPage('/cv', 'en');
    const html = await (res as Response).text();
    expect(html).toContain('mouseenter');
    expect(html).not.toContain('#include');
  });
});

describe('chrome translation', () => {
  test('renders English navigation labels by default', async () => {
    const res = await renderPage('/cv', 'en');
    const html = await (res as Response).text();
    expect(html).toContain('>Projects<');
    expect(html).toContain('>Logs<');
  });

  test('renders Russian navigation labels', async () => {
    const res = await renderPage('/cv', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('>Проекты<');
    expect(html).toContain('>Логи<');
    expect(html).toContain('>Резюме<');
  });

  test('keeps the CV pdf label untranslated', async () => {
    const res = await renderPage('/cv', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('CV.pdf');
  });
});

describe('russian fragments', () => {
  test('serves Russian CV prose', async () => {
    const res = await renderPage('/cv', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('Опыт');
    expect(html).not.toContain('Software and hardware for radio-frequency');
  });

  test('keeps stack names untranslated', async () => {
    const res = await renderPage('/cv', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('Feature-Sliced Design');
    expect(html).toContain('TypeScript');
    expect(html).toContain('SCPI / HiSLIP');
  });

  test('still serves English prose on the English page', async () => {
    const res = await renderPage('/cv', 'en');
    const html = await (res as Response).text();
    expect(html).toContain('Software and hardware for radio-frequency');
  });

  test('serves Russian copy on the home page', async () => {
    const res = await renderPage('/', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('aria-label="Статус сессии"');
    expect(html).toContain('id="terminal-input"');
  });
});

describe('home page', () => {
  test.each([
    { lang: 'en', label: 'Session status', tenure: 'shipping since 2021' },
    { lang: 'ru', label: 'Статус сессии', tenure: 'в проде с 2021' },
  ] as const)('renders the final status bar and tenure badge ($lang)', async ({ lang, label, tenure }) => {
    const res = await renderPage('/', lang);
    expect(res).not.toBeNull();
    const html = await (res as Response).text();
    const terminalStart = html.indexOf('id="terminal-wrap"');
    expect(terminalStart).toBeGreaterThan(-1);
    const terminal = html.slice(terminalStart, html.indexOf('</section>', terminalStart));
    expect(terminal).toContain(`aria-label="${label}"`);
    for (const content of ['stack:', 'now:', 'pantheon', 'utc+7']) {
      expect(terminal).toContain(content);
    }
    expect(html).toContain(tenure);
    for (const removed of ['Stats Grid', 'Availability', 'Окружение', 'prototype', 'herdr / opencode']) {
      expect(html).not.toContain(removed);
    }
  });

  test.each(['en', 'ru'] as const)('no longer renders the selected works section (%s)', async (lang) => {
    const res = await renderPage('/', lang);
    expect(res).not.toBeNull();
    const html = await (res as Response).text();
    expect(html).toContain('id="terminal-body"');
    expect(html).not.toContain('id="projects"');
    expect(html).not.toContain('/public/projects/telegram-bot.jpg');
    expect(html).not.toContain('t.me/adhavenBot');
  });
});

describe('client-side identity', () => {
  test.each(['/', '/projects', '/cv'])('no page ships client-side identity hooks (%s)', async (pathname) => {
    const res = await renderPage(pathname, 'en');
    expect(res).not.toBeNull();
    const html = await (res as Response).text();
    expect(html).not.toContain('x-user-email');
    expect(html).not.toContain('__DEV_USER_EMAIL__');
    expect(html).not.toContain('dev-user-email');
  });
});

describe('htmx setup', () => {
  test('configures htmx 4 before it loads so 4xx/5xx responses are not swapped, as in htmx 2', async () => {
    const res = await renderPage('/projects', 'en');
    const html = await (res as Response).text();
    const config = html.match(/<meta name="htmx-config" content='([^']+)'>/)?.[1];
    expect(config).toBeDefined();
    expect(JSON.parse(config ?? '{}')).toEqual({ noSwap: [204, 304, '4xx', '5xx'] });
    const htmxScriptIndex = html.search(/<script\b[^>]*htmx[^>]*>/);
    expect(htmxScriptIndex).toBeGreaterThan(-1);
    expect(html.indexOf('name="htmx-config"')).toBeLessThan(htmxScriptIndex);
  });
});

describe('public asset caching', () => {
  test('sends validators and a long-lived cache policy for fonts', async () => {
    const res = await servePublicAsset(FONT_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=604800, stale-while-revalidate=86400');
    expect(res.headers.get('etag')).toMatch(/^"\d+-\d+"$/);
    expect(res.headers.get('last-modified')).toMatch(/GMT$/);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    await res.arrayBuffer();
  });

  test('sends a short cache policy for text assets', async () => {
    const res = await servePublicAsset(SCRIPT_PATH);
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    await res.arrayBuffer();
  });

  test('answers a matching If-None-Match with 304 and the same validators', async () => {
    const first = await servePublicAsset(FONT_PATH);
    const etag = first.headers.get('etag') as string;
    await first.arrayBuffer();

    const res = await servePublicAsset(FONT_PATH, withHeaders(FONT_PATH, { 'if-none-match': etag }));
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe(etag);
    expect(res.headers.get('cache-control')).toBe('public, max-age=604800, stale-while-revalidate=86400');
    expect(await res.text()).toBe('');
  });

  test('keeps serving the body for a stale If-None-Match', async () => {
    const res = await servePublicAsset(FONT_PATH, withHeaders(FONT_PATH, { 'if-none-match': '"stale-1"' }));
    expect(res.status).toBe(200);
    await res.arrayBuffer();
  });

  test('supports HEAD without a body', async () => {
    const res = await servePublicAsset(FONT_PATH, withHeaders(FONT_PATH, {}, 'HEAD'));
    expect(res.status).toBe(200);
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0);
    expect(await res.text()).toBe('');
  });

  test('rejects a traversal attempt that escapes the public directory', async () => {
    const res = await servePublicAsset('/public/%2e%2e/server.ts');
    expect(res.status).toBe(403);
  });

  test('still rejects a malformed escape sequence', async () => {
    const res = await servePublicAsset('/public/%E0%A4%A');
    expect(res.status).toBe(400);
  });
});

describe('public asset ranges', () => {
  const pdfPath = '/public/Begench%20Geldyev(CV).pdf';

  test('answers a byte range with 206 and the requested bytes', async () => {
    const full = new Uint8Array(await Bun.file(join(import.meta.dir, 'public', 'Begench Geldyev(CV).pdf')).arrayBuffer());
    const res = await servePublicAsset(pdfPath, withHeaders(pdfPath, { range: 'bytes=0-99' }));

    expect(res.status).toBe(206);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-range')).toBe(`bytes 0-99/${full.length}`);

    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(100);
    expect(Array.from(body)).toEqual(Array.from(full.slice(0, 100)));
  });

  test('supports an open-ended range', async () => {
    const full = new Uint8Array(await Bun.file(join(import.meta.dir, 'public', 'Begench Geldyev(CV).pdf')).arrayBuffer());
    const res = await servePublicAsset(pdfPath, withHeaders(pdfPath, { range: 'bytes=4-' }));
    const body = new Uint8Array(await res.arrayBuffer());

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 4-${full.length - 1}/${full.length}`);
    expect(Array.from(body)).toEqual(Array.from(full.slice(4)));
  });

  test('answers an out-of-bounds range with 416', async () => {
    const res = await servePublicAsset(pdfPath, withHeaders(pdfPath, { range: 'bytes=999999999-' }));
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toMatch(/^bytes \*\/\d+$/);
  });
});

describe('page caching', () => {
  test('leaves dev responses uncached', async () => {
    const res = await renderPage('/cv', 'en');
    expect(res as Response).not.toBeNull();
    expect((res as Response).headers.get('etag')).toBeNull();
  });

  test('sends a revalidating cache policy and answers If-None-Match with 304 in production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const first = (await renderPage('/cv', 'en')) as Response;
      const etag = first.headers.get('etag') as string;
      const html = await first.text();

      expect(first.headers.get('cache-control')).toBe('no-cache');
      expect(first.headers.get('vary')).toBe('Cookie');
      expect(etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);

      const revalidated = (await renderPage('/cv', 'en', withHeaders('/cv', { 'if-none-match': etag }))) as Response;
      expect(revalidated.status).toBe(304);
      expect(revalidated.headers.get('etag')).toBe(etag);

      const cached = (await renderPage('/cv', 'en')) as Response;
      expect(cached.headers.get('etag')).toBe(etag);
      expect(await cached.text()).toBe(html);
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previous;
      }
    }
  });
});
