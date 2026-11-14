import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { type Lang, localizedFragmentFile, resolveLang, t } from './i18n';

type NavKey = 'projects' | 'logs' | 'cv';
type FooterVariant = 'default' | 'home';

type LayoutConfig = {
  title: Record<Lang, string>;
  activeNav?: NavKey;
  brandIsLink?: boolean;
  footerVariant?: FooterVariant;
  includeCvLink?: boolean;
  selectionTextClass?: string;
  showTerminalIcon?: boolean;
  pageTransitions?: boolean;
};

type PageConfig = LayoutConfig & { fragmentFile: string };

type DynamicPage = {
  page: 'project' | 'admin';
  /** Raw text; document rendering owns escaping. */
  title: string;
  /** Trusted, already-rendered HTML, not text to escape. */
  contentHtml: string;
};

const DYNAMIC_PAGE_CONFIGS: Record<DynamicPage['page'], Omit<LayoutConfig, 'title'>> = {
  project: {
    activeNav: 'projects',
    brandIsLink: true,
    footerVariant: 'default',
    showTerminalIcon: true,
  },
  admin: {
    brandIsLink: true,
    footerVariant: 'default',
    showTerminalIcon: true,
    pageTransitions: false,
  },
};

const APP_DIR = import.meta.dir;
const PAGES_DIR = join(APP_DIR, 'pages');
const COMPONENTS_DIR = join(APP_DIR, 'components');
const PUBLIC_DIR = join(APP_DIR, 'public');
const templateCache = new Map<string, Promise<string>>();
const assetMetaCache = new Map<string, Promise<AssetMeta>>();
const pageCache = new Map<string, PageEntry>();

// Content is static and only re-rendered by a deploy, so caches are only safe in production (dev serves hot edits).
function isProduction() {
  return process.env.NODE_ENV === 'production';
}

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=604800, stale-while-revalidate=86400';
const TEXT_CACHE_CONTROL = 'public, max-age=3600';
const LONG_LIVED_EXTENSIONS = new Set(['.avif', '.jpeg', '.jpg', '.png', '.ttf', '.webp', '.woff2']);

const MIME: Record<string, string> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

type AssetMeta = {
  size: number;
  etag: string;
  lastModified?: string;
};

type PageEntry = {
  html: string;
  etag: string;
};

type ByteRange = { start: number; end: number };

function isNotModified(req: Request | undefined, etag: string) {
  const ifNoneMatch = req?.headers.get('if-none-match');
  if (!ifNoneMatch) {
    return false;
  }

  return ifNoneMatch.split(',').some((candidate) => {
    const tag = candidate.trim();
    return tag === '*' || tag === etag || tag === `W/${etag}`;
  });
}

function parseSingleRange(header: string, size: number): ByteRange | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) {
    return null;
  }

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') {
    return null;
  }

  if (rawStart === '') {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Number(rawEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) {
    return 'unsatisfiable';
  }

  return { start, end: Math.min(end, size - 1) };
}

// size + mtime is enough to tell two revisions of the same file apart without hashing it.
function assetMeta(assetPath: string, fileSize: number): Promise<AssetMeta> {
  const cached = assetMetaCache.get(assetPath);
  if (cached) {
    return cached;
  }

  const promise = stat(assetPath).then(
    (info): AssetMeta => ({
      size: info.size,
      etag: `"${info.size}-${Math.floor(info.mtimeMs)}"`,
      lastModified: info.mtime.toUTCString(),
    }),
    (): AssetMeta => ({ size: fileSize, etag: `"${fileSize}-0"` }),
  );

  if (isProduction()) {
    assetMetaCache.set(assetPath, promise);
  }

  return promise;
}

function pageEtag(html: string) {
  const digest = new Bun.CryptoHasher('sha1').update(html).digest('hex').slice(0, 20);
  return `"${html.length.toString(16)}-${digest}"`;
}

function htmlResponse(html: string, etag: string, req: Request | undefined): Response {
  const headers = new Headers({
    'Cache-Control': 'no-cache',
    'Content-Type': 'text/html; charset=utf-8',
    ETag: etag,
    Vary: 'Cookie',
  });

  if (isNotModified(req, etag)) {
    return new Response(null, { status: 304, headers });
  }

  if (req?.method === 'HEAD') {
    headers.set('Content-Length', String(Buffer.byteLength(html)));
    return new Response(null, { headers });
  }

  return new Response(html, { headers });
}

const PAGE_CONFIGS: Record<string, PageConfig> = {
  '/': {
    title: { en: 'begenchgeldyev', ru: 'begenchgeldyev' },
    fragmentFile: 'index.html',
    brandIsLink: false,
    footerVariant: 'home',
    includeCvLink: true,
    selectionTextClass: 'selection:text-on-primary-fixed',
  },
  '/cv': {
    title: { en: 'CV — BEGENCH_GELDYEV@ROOT:~$', ru: 'РЕЗЮМЕ — BEGENCH_GELDYEV@ROOT:~$' },
    fragmentFile: 'cv.html',
    activeNav: 'cv',
    brandIsLink: true,
    footerVariant: 'default',
    includeCvLink: true,
    showTerminalIcon: true,
  },
  '/logs': {
    title: { en: 'LOGS — BEGENCH_GELDYEV@ROOT:~$', ru: 'ЛОГИ — BEGENCH_GELDYEV@ROOT:~$' },
    fragmentFile: 'logs.html',
    activeNav: 'logs',
    brandIsLink: true,
    footerVariant: 'default',
    showTerminalIcon: true,
  },
  '/projects': {
    title: { en: 'PROJECTS — BEGENCH_GELDYEV@ROOT:~$', ru: 'ПРОЕКТЫ — BEGENCH_GELDYEV@ROOT:~$' },
    fragmentFile: 'projects.html',
    activeNav: 'projects',
    brandIsLink: true,
    footerVariant: 'default',
    showTerminalIcon: true,
  },
};

function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => values[key] ?? '');
}

async function loadTemplate(templatePath: string) {
  if (process.env.NODE_ENV === 'production') {
    const cached = templateCache.get(templatePath);
    if (cached) return cached;
    const promise = Bun.file(templatePath).text();
    templateCache.set(templatePath, promise);
    return promise;
  }

  return Bun.file(templatePath).text();
}

export async function renderComponentTemplate(componentPath: string, values: Record<string, string> = {}) {
  const template = await loadTemplate(join(COMPONENTS_DIR, componentPath));
  return fillTemplate(template, values);
}

async function renderSharedHead() {
  return renderComponentTemplate('shared-head.html');
}

function renderNavLink(activeNav: NavKey | undefined, href: string, label: string, key: NavKey) {
  const isActive = activeNav === key;
  const classes = isActive
    ? 'inline-flex items-center min-h-11 font-label uppercase tracking-wider text-sm font-semibold text-primary-container'
    : 'inline-flex items-center min-h-11 font-label uppercase tracking-wider text-sm font-semibold text-white/80 hover:text-primary-container transition-colors';
  const current = isActive ? ' aria-current="page"' : '';
  const labelClasses = isActive ? 'border-b-2 border-primary-container pb-1' : 'border-b-2 border-transparent pb-1';
  return `<a class="${classes}" href="${href}"${current}><span class="${labelClasses}">${label}</span></a>`;
}

async function renderHeader(config: LayoutConfig, lang: Lang) {
  const brand = config.brandIsLink
    ? `<a href="/" class="text-[#00FF41] font-mono font-bold tracking-widest text-sm hover:opacity-80 transition-opacity">
      begench@127.0.0.1
    </a>`
    : `<div class="text-[#00FF41] font-mono font-bold tracking-widest text-sm">
      begench@127.0.0.1 <span class="hidden sm:inline opacity-60">WHOAMI</span>
    </div>`;

  const terminal = config.showTerminalIcon
    ? `<span class="material-symbols-outlined hidden sm:inline-block cursor-default" aria-hidden="true">terminal</span>`
    : '';

  const langButtons = (['en', 'ru'] as const)
    .map((code) => {
      const active = code === lang;
      const classes = active ? 'text-primary-container font-semibold' : 'text-white/80 hover:text-primary-container transition-colors';
      return `<button type="button" data-lang="${code}" aria-pressed="${active}" class="min-w-9 min-h-11 ${classes}">${code}</button>`;
    })
    .join('<span class="text-outline-variant/60" aria-hidden="true">|</span>');

  const langToggle = `<div class="flex items-center gap-1 font-mono text-sm uppercase tracking-wider" role="group" aria-label="${t(lang, 'langToggleLabel')}">${langButtons}</div>
<script>
  document.querySelectorAll('[data-lang]').forEach((el) => {
    const switchTo = async () => {
      await fetch('/api/lang', { method: 'POST', body: el.dataset.lang });
      location.reload();
    };
    el.addEventListener('mousedown', switchTo);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchTo();
      }
    });
  });
</script>`;

  return renderComponentTemplate('site-header.html', {
    brand,
    langToggle,
    navLinks: [
      renderNavLink(config.activeNav, '/projects', t(lang, 'navProjects'), 'projects'),
      renderNavLink(config.activeNav, '/logs', t(lang, 'navLogs'), 'logs'),
      renderNavLink(config.activeNav, '/cv', t(lang, 'navCv'), 'cv'),
    ].join(''),
    terminal,
  });
}

async function renderFooter(config: LayoutConfig, lang: Lang) {
  if (config.footerVariant === 'home') {
    return renderComponentTemplate('footer-home.html');
  }

  const cvLink = config.includeCvLink
    ? `<a class="font-mono text-xs tracking-widest text-primary-container underline font-bold uppercase" href="/public/Begench%20Geldyev(CV).pdf" target="_blank">${t(lang, 'footerCvLink')}</a>`
    : '';

  return renderComponentTemplate('footer-default.html', { cvLink });
}

async function renderLayout(config: LayoutConfig, content: string, lang: Lang) {
  const selectionTextClass = config.selectionTextClass ?? 'selection:text-on-primary-container';
  return renderComponentTemplate('document.html', {
    content,
    footer: await renderFooter(config, lang),
    header: await renderHeader(config, lang),
    lang,
    pageTransitions: config.pageTransitions === false ? '' : await renderComponentTemplate('page-transitions.html'),
    selectionTextClass,
    sharedHead: await renderSharedHead(),
    title: config.title[lang]
      .toLowerCase()
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;'),
  });
}

export async function renderDynamicPage(req: Request, { page, title, contentHtml }: DynamicPage): Promise<Response> {
  const lang = page === 'admin' ? 'en' : resolveLang(req);
  const html = await renderLayout({ ...DYNAMIC_PAGE_CONFIGS[page], title: { en: title, ru: title } }, contentHtml, lang);
  // These documents depend on the current session and must never share static-page
  // caching or conditional revalidation, even when the title/body happen to match.
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  if (page === 'admin') headers.set('X-Robots-Tag', 'noindex');
  if (req.method === 'HEAD') {
    headers.set('Content-Length', String(Buffer.byteLength(html)));
    return new Response(null, { headers });
  }
  return new Response(html, { headers });
}

async function resolveIncludes(html: string): Promise<string> {
  const includeRe = /<!--#include\s+(.+?)\s*-->/g;
  const matches = [...html.matchAll(includeRe)];
  for (const match of matches) {
    const componentPath = join(COMPONENTS_DIR, match[1].trim());
    const file = Bun.file(componentPath);
    const content = (await file.exists()) ? await file.text() : `<!-- missing: ${match[1].trim()} -->`;
    html = html.replace(match[0], () => content);
  }
  return html;
}

export async function renderPage(pathname: string, lang: Lang, req?: Request): Promise<Response | null> {
  const config = PAGE_CONFIGS[pathname];
  if (!config) {
    return null;
  }

  const cacheable = isProduction();
  const cacheKey = `${pathname}:${lang}`;
  const cached = cacheable ? pageCache.get(cacheKey) : undefined;
  if (cached) {
    return htmlResponse(cached.html, cached.etag, req);
  }

  const localized = Bun.file(join(PAGES_DIR, localizedFragmentFile(config.fragmentFile, lang)));
  const fallback = Bun.file(join(PAGES_DIR, config.fragmentFile));
  const fragment = (await localized.exists()) ? localized : fallback;

  if (!(await fragment.exists())) {
    return new Response('Not Found', { status: 404 });
  }

  const content = await resolveIncludes(await fragment.text());
  const html = await renderLayout(config, content, lang);

  if (!cacheable) {
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const etag = pageEtag(html);
  pageCache.set(cacheKey, { html, etag });
  return htmlResponse(html, etag, req);
}

export async function servePublicAsset(pathname: string, req?: Request): Promise<Response> {
  let relativePath: string;

  try {
    relativePath = decodeURIComponent(pathname.slice('/public/'.length));
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const assetPath = normalize(join(PUBLIC_DIR, relativePath));
  const inPublicDir = assetPath === PUBLIC_DIR || assetPath.startsWith(`${PUBLIC_DIR}${sep}`);
  if (!inPublicDir) {
    return new Response('Forbidden', { status: 403 });
  }

  const file = Bun.file(assetPath);
  if (!(await file.exists())) {
    return new Response('Not Found', { status: 404 });
  }

  const extension = extname(assetPath);
  const meta = await assetMeta(assetPath, file.size);
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': LONG_LIVED_EXTENSIONS.has(extension) ? IMMUTABLE_CACHE_CONTROL : TEXT_CACHE_CONTROL,
    'Content-Type': MIME[extension] ?? 'application/octet-stream',
    ETag: meta.etag,
  });
  if (meta.lastModified) {
    headers.set('Last-Modified', meta.lastModified);
  }

  if (isNotModified(req, meta.etag)) {
    return new Response(null, { status: 304, headers });
  }

  const rangeHeader = req?.headers.get('range');
  if (rangeHeader && meta.size > 0) {
    const range = parseSingleRange(rangeHeader, meta.size);
    if (range === 'unsatisfiable') {
      headers.set('Content-Range', `bytes */${meta.size}`);
      return new Response(null, { status: 416, headers });
    }

    if (range) {
      headers.set('Content-Length', String(range.end - range.start + 1));
      headers.set('Content-Range', `bytes ${range.start}-${range.end}/${meta.size}`);
      const body = req?.method === 'HEAD' ? null : file.slice(range.start, range.end + 1);
      return new Response(body, { status: 206, headers });
    }
  }

  if (req?.method === 'HEAD') {
    headers.set('Content-Length', String(meta.size));
    return new Response(null, { headers });
  }

  return new Response(file, { headers });
}
