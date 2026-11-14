import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { localizedFragmentFile } from './i18n';
import * as rendering from './site';
import { renderPage, servePublicAsset } from './site';

const FONT_PATH = '/public/fonts/OpenTUIMono-Regular.woff2';
const SCRIPT_PATH = '/public/hero-role.js';
const RESUME_PDF = '/public/Begench-Geldyev-Resume.pdf';
const LEGACY_PDFS = ['/public/Begench Geldyev(CV).pdf', '/public/Begench%20Geldyev(CV).pdf'];

function withHeaders(pathname: string, headers: Record<string, string>, method = 'GET') {
  return new Request(`http://localhost${pathname}`, { headers, method });
}

describe('canonical resume', () => {
  test.each([
    { lang: 'en', label: 'Resume', download: 'Download resume' },
    { lang: 'ru', label: 'Резюме', download: 'Скачать резюме' },
  ] as const)('renders a complete translated resume ($lang)', async ({ lang, label, download }) => {
    const res = await renderPage('/resume', lang);
    expect(res?.status).toBe(200);
    const html = await (res as Response).text();
    expect(html).toContain('href="/resume" aria-current="page"');
    expect(html).toContain(`>${label}<`);
    expect(html).toMatch(/<h1\b[^>]*>Begench Geldyev<\/h1>/);
    expect(html).toContain(`[${label}]`);
    const pageHeader = html.match(/<main\b[^>]*>\s*(<header\b[\s\S]*?<\/header>)/)?.[1] ?? '';
    expect(pageHeader).toContain(download);
    expect(pageHeader).toContain(`href="${RESUME_PDF}"`);
    expect(pageHeader).toMatch(/<a\b[^>]*\bdownload\b[^>]*>/);
    expect(html).not.toContain('<!-- missing:');
    expect(html).not.toContain('{{');
    expect(html).not.toContain('href="/cv"');
  });

  test.each(['GET', 'HEAD'])('redirects legacy %s before conditional page caching and preserves the query', async (method) => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const canonical = await renderPage('/resume', 'en');
      for (const search of ['', '?source=mail&return=%2Fprojects']) {
        for (const tag of ['*', canonical?.headers.get('etag') ?? '"stale"']) {
          const res = await renderPage('/cv', 'en', withHeaders(`/cv${search}`, { 'if-none-match': tag }, method));
          expect(res?.status).toBe(308);
          expect(res?.headers.get('location')).toBe(`/resume${search}`);
          expect(await (res as Response).text()).toBe('');
        }
      }
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  test('does not redirect unrelated paths', async () => {
    expect(await renderPage('/cv/extra', 'en')).toBeNull();
  });

  test('development HEAD is bodyless with the GET byte length', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const get = await renderPage('/resume', 'ru');
      expect(get?.status).toBe(200);
      const html = await (get as Response).text();
      const head = await renderPage('/resume', 'ru', withHeaders('/resume', {}, 'HEAD'));
      expect(head?.status).toBe(200);
      expect(head?.headers.get('content-length')).toBe(String(Buffer.byteLength(html)));
      expect(head?.headers.get('etag')).toBeNull();
      expect(await (head as Response).text()).toBe('');
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});

describe('home footer contacts', () => {
  test.each(['en', 'ru'] as const)('offers a clickable email and two social profiles without a duplicate download (%s)', async (lang) => {
    const response = await renderPage('/', lang);
    expect(response?.status).toBe(200);
    const links: { href: string | null; text: string; target: string | null; rel: string | null }[] = [];
    let footerCount = 0;
    let footerText = '';
    await new HTMLRewriter()
      .on('footer', {
        element() {
          footerCount++;
        },
        text(chunk) {
          footerText += chunk.text;
        },
      })
      .on('footer a', {
        element(element) {
          links.push({
            href: element.getAttribute('href'),
            text: '',
            target: element.getAttribute('target'),
            rel: element.getAttribute('rel'),
          });
        },
        text(chunk) {
          links[links.length - 1].text += chunk.text;
        },
      })
      .transform(response as Response)
      .text();
    expect(footerCount).toBe(1);
    expect(links.map((link) => ({ ...link, text: link.text.trim() }))).toEqual([
      { href: 'mailto:begenchgeldyev@gmail.com', text: 'begenchgeldyev@gmail.com', target: null, rel: null },
      { href: 'https://github.com/begenchgeldyev', text: 'GitHub', target: '_blank', rel: 'noopener noreferrer' },
      { href: 'https://linkedin.com/in/begench-geldyev', text: 'LinkedIn', target: '_blank', rel: 'noopener noreferrer' },
    ]);
    expect(footerText).not.toMatch(/©|copyright|resume|резюме|\.pdf/i);
  });
});

describe('resume PDF compatibility', () => {
  test.each([RESUME_PDF, ...LEGACY_PDFS])('serves full bytes and PDF protocols at %s', async (path) => {
    const res = await servePublicAsset(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const file = new Uint8Array(await Bun.file(join(import.meta.dir, 'public', 'Begench-Geldyev-Resume.pdf')).arrayBuffer());
    expect(bytes).toEqual(file);
    const canonical = await servePublicAsset(RESUME_PDF);
    expect(canonical.status).toBe(200);
    for (const header of ['etag', 'last-modified', 'cache-control', 'accept-ranges', 'content-type']) {
      expect(res.headers.get(header)).toBe(canonical.headers.get(header));
    }
    expect(new Uint8Array(await canonical.arrayBuffer())).toEqual(bytes);
    const head = await servePublicAsset(path, withHeaders(path, {}, 'HEAD'));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(bytes.length));
    expect(await head.text()).toBe('');
    for (const method of ['GET', 'HEAD']) {
      const partial = await servePublicAsset(path, withHeaders(path, { range: 'bytes=0-99' }, method));
      expect(partial.status).toBe(206);
      expect(partial.headers.get('content-type')).toBe('application/pdf');
      expect(partial.headers.get('content-length')).toBe('100');
      expect(partial.headers.get('content-range')).toBe(`bytes 0-99/${bytes.length}`);
      expect(new Uint8Array(await partial.arrayBuffer())).toEqual(method === 'HEAD' ? new Uint8Array() : bytes.slice(0, 100));
      const invalid = await servePublicAsset(path, withHeaders(path, { range: 'bytes=999999999-' }, method));
      expect(invalid.status).toBe(416);
      expect(invalid.headers.get('content-range')).toBe(`bytes */${bytes.length}`);
      expect(await invalid.text()).toBe('');
      const cached = await servePublicAsset(path, withHeaders(path, { 'if-none-match': res.headers.get('etag') as string }, method));
      expect(cached.status).toBe(304);
      expect(cached.headers.get('etag')).toBe(res.headers.get('etag'));
      expect(await cached.text()).toBe('');
    }
  });
});

describe('renderPage language selection', () => {
  test('renders the English fragment by default', async () => {
    const res = await renderPage('/resume', 'en');
    expect(res).not.toBeNull();
    const html = await (res as Response).text();
    expect(html).toContain('Experience');
  });

  test('derives the translated filename and still serves 200', async () => {
    expect(localizedFragmentFile('nonexistent.html', 'ru')).toBe('nonexistent.ru.html');

    const res = await renderPage('/resume', 'ru');
    expect((res as Response).status).toBe(200);
  });

  test('returns null for an unknown path', async () => {
    expect(await renderPage('/nope', 'en')).toBeNull();
  });

  test('sets the html lang attribute from the language', async () => {
    const res = await renderPage('/resume', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('lang="ru"');
  });
});

describe('static document titles', () => {
  test.each([
    { pathname: '/', lang: 'en', title: 'begenchgeldyev' },
    { pathname: '/', lang: 'ru', title: 'begenchgeldyev' },
    { pathname: '/resume', lang: 'en', title: 'resume — begench_geldyev@root:~$' },
    { pathname: '/resume', lang: 'ru', title: 'резюме — begench_geldyev@root:~$' },
    { pathname: '/logs', lang: 'en', title: 'logs — begench_geldyev@root:~$' },
    { pathname: '/logs', lang: 'ru', title: 'логи — begench_geldyev@root:~$' },
    { pathname: '/projects', lang: 'en', title: 'projects — begench_geldyev@root:~$' },
    { pathname: '/projects', lang: 'ru', title: 'проекты — begench_geldyev@root:~$' },
  ] as const)('renders a lowercase title for $pathname ($lang)', async ({ pathname, lang, title }) => {
    const response = await renderPage(pathname, lang);
    expect(response).not.toBeNull();
    const html = await (response as Response).text();
    expect(html.match(/<title>(.*?)<\/title>/)?.[1]).toBe(title);
  });
});

describe('include resolution', () => {
  test('resolves an include whose filename contains a hyphen', async () => {
    const res = await renderPage('/resume', 'en');
    const html = await (res as Response).text();
    expect(html).toContain('mouseenter');
    expect(html).not.toContain('#include');
  });
});

describe('chrome translation', () => {
  test('renders English navigation labels by default', async () => {
    const res = await renderPage('/resume', 'en');
    const html = await (res as Response).text();
    expect(html).toContain('>Projects<');
    expect(html).toContain('>Logs<');
  });

  test('renders Russian navigation labels', async () => {
    const res = await renderPage('/resume', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('>Проекты<');
    expect(html).toContain('>Логи<');
    expect(html).toContain('>Резюме<');
  });

  test('translates the resume download label', async () => {
    const res = await renderPage('/resume', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('Скачать резюме');
  });
});

describe('russian fragments', () => {
  test('serves Russian resume prose', async () => {
    const res = await renderPage('/resume', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('Опыт');
    expect(html).not.toContain('Software and hardware for radio-frequency');
  });

  test('keeps stack names untranslated', async () => {
    const res = await renderPage('/resume', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('Feature-Sliced Design');
    expect(html).toContain('TypeScript');
    expect(html).toContain('SCPI / HiSLIP');
  });

  test('still serves English prose on the English page', async () => {
    const res = await renderPage('/resume', 'en');
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
  test.each(['/', '/projects', '/resume'])('no page ships client-side identity hooks (%s)', async (pathname) => {
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
  const pdfPath = '/public/Begench-Geldyev-Resume.pdf';

  test('answers a byte range with 206 and the requested bytes', async () => {
    const full = new Uint8Array(await Bun.file(join(import.meta.dir, 'public', 'Begench-Geldyev-Resume.pdf')).arrayBuffer());
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
    const full = new Uint8Array(await Bun.file(join(import.meta.dir, 'public', 'Begench-Geldyev-Resume.pdf')).arrayBuffer());
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

describe('dynamic document policy', () => {
  test.each(['project', 'admin'] as const)('lowercases mixed-case Latin and Cyrillic %s titles without changing the body', async (page) => {
    const response = await rendering.renderDynamicPage(withHeaders('/fixture', { cookie: 'lang=ru' }), {
      page,
      title: 'MiXeD ПроЕкт ЁЖ — BEGENCH_GELDYEV@ROOT:~$',
      contentHtml: '<main><h1>MiXeD ПроЕкт ЁЖ</h1></main>',
    });
    const html = await response.text();
    expect(html).toContain('<title>mixed проект ёж — begench_geldyev@root:~$</title>');
    expect(html).toContain('<main><h1>MiXeD ПроЕкт ЁЖ</h1></main>');
  });

  test.each(['project', 'admin'] as const)('escapes raw %s titles once and preserves trusted body HTML', async (page) => {
    const response = await rendering.renderDynamicPage(new Request('http://localhost/fixture'), {
      page,
      title: '</TITLE><SCRIPT>EVIL()</SCRIPT> & "RaW" \'Quote\' &amp;',
      contentHtml: '<main><strong data-trusted="yes">Intentional HTML &amp; text</strong></main>',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('etag')).toBeNull();
    const html = await response.text();
    expect(html).toContain(
      '<title>&lt;/title&gt;&lt;script&gt;evil()&lt;/script&gt; &amp; &quot;raw&quot; &#39;quote&#39; &amp;amp;</title>',
    );
    expect(html).not.toContain('<SCRIPT>EVIL()');
    expect(html).not.toContain('<script>evil()');
    expect(html).toContain('<main><strong data-trusted="yes">Intentional HTML &amp; text</strong></main>');
  });

  test.each([
    'project',
    'admin',
  ] as const)('%s HEAD has GET metadata and byte length, never revalidates a session document', async (page) => {
    const options = { page, title: 'Название', contentHtml: '<main>Привет</main>' };
    const get = await rendering.renderDynamicPage(withHeaders('/fixture', { cookie: 'lang=ru; bg_session=owner' }), options);
    const html = await get.text();
    const head = await rendering.renderDynamicPage(
      withHeaders('/fixture', { cookie: 'lang=ru; bg_session=owner', 'if-none-match': '*' }, 'HEAD'),
      options,
    );
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength(html)));
    expect(await head.text()).toBe('');
    for (const header of ['content-type', 'cache-control', 'x-robots-tag', 'etag']) {
      expect(head.headers.get(header)).toBe(get.headers.get(header));
    }
    const conditional = await rendering.renderDynamicPage(withHeaders('/fixture', { 'if-none-match': '*' }), options);
    expect(conditional.status).toBe(200);
    expect(await conditional.text()).toContain('<main>Привет</main>');
  });

  test('project preset follows the language cookie and retains public chrome and transitions', async () => {
    const response = await rendering.renderDynamicPage(withHeaders('/projects/1', { cookie: 'lang=ru' }), {
      page: 'project',
      title: 'PROJECT',
      contentHtml: '<main>Body</main>',
    });
    const html = await response.text();
    expect(html).toContain('<html class="dark" lang="ru">');
    expect(html).toContain('>Проекты<');
    expect(html).toContain('href="/projects" aria-current="page"');
    expect(html).toContain('type="speculationrules"');
    expect(html).toContain('@view-transition');
    expect(response.headers.get('x-robots-tag')).toBeNull();
  });

  test('admin preset overrides Russian with English and excludes indexing and transitions', async () => {
    const response = await rendering.renderDynamicPage(withHeaders('/admin', { cookie: 'lang=ru' }), {
      page: 'admin',
      title: 'ADMIN',
      contentHtml: '<main>Body</main>',
    });
    const html = await response.text();
    expect(html).toContain('<html class="dark" lang="en">');
    expect(html).toContain('>Projects<');
    expect(html).not.toContain('aria-current="page"');
    expect(html).not.toContain('type="speculationrules"');
    expect(html).not.toContain('@view-transition');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
  });
});

describe('page caching', () => {
  test('production static ETags remain language-specific for GET, revalidation and HEAD', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const english = (await renderPage('/resume', 'en')) as Response;
      const russian = (await renderPage('/resume', 'ru')) as Response;
      const enTag = english.headers.get('etag') as string;
      const ruTag = russian.headers.get('etag') as string;
      expect(enTag).not.toBe(ruTag);
      const ruHtml = await russian.text();
      const mismatch = (await renderPage('/resume', 'ru', withHeaders('/resume', { 'if-none-match': enTag }))) as Response;
      expect(mismatch.status).toBe(200);
      expect(await mismatch.text()).toBe(ruHtml);
      const matching = (await renderPage('/resume', 'ru', withHeaders('/resume', { 'if-none-match': ruTag }))) as Response;
      expect(matching.status).toBe(304);
      expect(await matching.text()).toBe('');
      const head = (await renderPage('/resume', 'ru', withHeaders('/resume', {}, 'HEAD'))) as Response;
      expect(head.headers.get('etag')).toBe(ruTag);
      expect(head.headers.get('vary')).toBe('Cookie');
      expect(head.headers.get('cache-control')).toBe('no-cache');
      expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength(ruHtml)));
      expect(await head.text()).toBe('');
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  test('leaves dev responses uncached', async () => {
    const res = await renderPage('/resume', 'en');
    expect(res as Response).not.toBeNull();
    expect((res as Response).headers.get('etag')).toBeNull();
  });

  test('sends a revalidating cache policy and answers If-None-Match with 304 in production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const first = (await renderPage('/resume', 'en')) as Response;
      const etag = first.headers.get('etag') as string;
      const html = await first.text();

      expect(first.headers.get('cache-control')).toBe('no-cache');
      expect(first.headers.get('vary')).toBe('Cookie');
      expect(etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);

      const revalidated = (await renderPage('/resume', 'en', withHeaders('/resume', { 'if-none-match': etag }))) as Response;
      expect(revalidated.status).toBe(304);
      expect(revalidated.headers.get('etag')).toBe(etag);

      const cached = (await renderPage('/resume', 'en')) as Response;
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
