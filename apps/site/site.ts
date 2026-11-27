import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { getClientBundle } from './client-bundle';
import { assetResponse, CONTENT_CACHE_CONTROL, ContentAssets, isNotModified, rewriteAssetUrls } from './content-assets';
import { type Lang, localizedFragmentFile, resolveLang, t } from './i18n';

type NavKey = 'projects' | 'logs' | 'resume';

type LayoutConfig = {
  title: Record<Lang, string>;
  activeNav?: NavKey;
  brandIsLink?: boolean;
  selectionTextClass?: string;
  headerTerminal?: 'decorative' | 'panel';
  pageTransitions?: boolean;
  htmx?: boolean;
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
    headerTerminal: 'panel',
  },
  admin: {
    brandIsLink: true,
    headerTerminal: 'decorative',
    pageTransitions: false,
  },
};

const APP_DIR = import.meta.dir;
const PAGES_DIR = join(APP_DIR, 'pages');
const COMPONENTS_DIR = join(APP_DIR, 'components');
const PUBLIC_DIR = join(APP_DIR, 'public');
const contentAssets = new ContentAssets(PUBLIC_DIR);
const templateCache = new Map<string, Promise<string>>();
const assetMetaCache = new Map<string, Promise<AssetMeta>>();
const pageCache = new Map<string, PageEntry>();

// Content is static and only re-rendered by a deploy, so caches are only safe in production (dev serves hot edits).
function isProduction() {
  return process.env.NODE_ENV === 'production';
}

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=604800, stale-while-revalidate=86400';
// Text assets are rebuilt under the same URL, so a stored copy must revalidate before it is reused.
const REVALIDATE_CACHE_CONTROL = 'no-cache';
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
    selectionTextClass: 'selection:text-on-primary-fixed',
  },
  '/resume': {
    title: { en: 'Resume — BEGENCH_GELDYEV@ROOT:~$', ru: 'Резюме — BEGENCH_GELDYEV@ROOT:~$' },
    fragmentFile: 'resume.html',
    activeNav: 'resume',
    brandIsLink: true,
    headerTerminal: 'panel',
  },
  '/logs': {
    htmx: true,
    title: { en: 'LOGS — BEGENCH_GELDYEV@ROOT:~$', ru: 'ЛОГИ — BEGENCH_GELDYEV@ROOT:~$' },
    fragmentFile: 'logs.html',
    activeNav: 'logs',
    brandIsLink: true,
    headerTerminal: 'panel',
  },
  '/projects': {
    htmx: true,
    title: { en: 'PROJECTS — BEGENCH_GELDYEV@ROOT:~$', ru: 'ПРОЕКТЫ — BEGENCH_GELDYEV@ROOT:~$' },
    fragmentFile: 'projects.html',
    activeNav: 'projects',
    brandIsLink: true,
    headerTerminal: 'panel',
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
  return fillTemplate(await renderAssetUrls(template), values);
}

async function renderAssetUrls(template: string) {
  if (!isProduction()) return template;
  return rewriteAssetUrls(template, async (path) => {
    if (path === '/assets/ask-chat.js') return (await getClientBundle())?.url ?? path;
    return contentAssets.url(path);
  });
}

async function renderSharedHead(config: LayoutConfig) {
  const htmxUrl = config.htmx && isProduction() ? await contentAssets.url('/public/vendor/htmx.min.js') : '/public/vendor/htmx.min.js';
  return renderComponentTemplate('shared-head.html', {
    htmx: config.htmx ? `<script src="${htmxUrl}" defer></script>` : '',
  });
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
    ? `<a href="/" class="text-primary-container font-mono font-bold tracking-widest text-sm hover:opacity-80 transition-opacity">
      begench@127.0.0.1
    </a>`
    : `<div class="text-primary-container font-mono font-bold tracking-widest text-sm">
      begench@127.0.0.1 <span class="hidden sm:inline opacity-60">WHOAMI</span>
    </div>`;

  let terminal = '';
  if (config.headerTerminal === 'decorative') {
    terminal = '<span class="material-symbols-outlined hidden sm:inline-block cursor-default" aria-hidden="true">terminal</span>';
  } else if (config.headerTerminal === 'panel') {
    const label = t(lang, 'terminalToggleLabel');
    terminal = `<button type="button" data-terminal-launcher aria-controls="terminal-wrap" aria-expanded="false" aria-label="${label}" title="${label}" class="h-11 w-11 cursor-pointer text-on-surface-variant hover:text-primary-container" hidden>
      <span class="material-symbols-outlined" aria-hidden="true">terminal</span>
    </button>`;
  }

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
      renderNavLink(config.activeNav, '/resume', t(lang, 'navResume'), 'resume'),
    ].join(''),
    terminal,
  });
}

async function renderFooter(lang: Lang) {
  return renderComponentTemplate('footer.html', {
    copyEmailLabel: t(lang, 'copyEmailLabel'),
    copyEmailSuccess: t(lang, 'copyEmailSuccess'),
    copyEmailFailure: t(lang, 'copyEmailFailure'),
  });
}

function terminalBodyCopy(lang: Lang) {
  return { terminalIntro: t(lang, 'terminalIntro'), terminalPromptLabel: t(lang, 'terminalPromptLabel') };
}

function renderTerminalFullscreenButton(lang: Lang) {
  return renderComponentTemplate('terminal-fullscreen-button.html', {
    terminalExpandLabel: t(lang, 'terminalExpandLabel'),
    terminalRestoreLabel: t(lang, 'terminalRestoreLabel'),
  });
}

async function renderTerminalPanel(lang: Lang): Promise<string> {
  return renderComponentTemplate('terminal-panel.html', {
    terminalTitle: t(lang, 'terminalTitle'),
    terminalCloseLabel: t(lang, 'terminalCloseLabel'),
    terminalBody: await renderComponentTemplate('terminal-body.html', terminalBodyCopy(lang)),
    terminalEmulator: await renderComponentTemplate('terminal-emulator.html'),
    terminalFullscreenButton: await renderTerminalFullscreenButton(lang),
  });
}

async function renderLayout(config: LayoutConfig, content: string, lang: Lang) {
  const selectionTextClass = config.selectionTextClass ?? 'selection:text-on-primary-container';
  return renderComponentTemplate('document.html', {
    content,
    footer: await renderFooter(lang),
    header: await renderHeader(config, lang),
    lang,
    pageTransitions: config.pageTransitions === false ? '' : await renderComponentTemplate('page-transitions.html'),
    selectionTextClass,
    sharedHead: await renderSharedHead(config),
    terminalPanel: config.headerTerminal === 'panel' ? await renderTerminalPanel(lang) : '',
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

async function resolveIncludes(html: string, values: Record<string, string>): Promise<string> {
  const includeRe = /<!--#include\s+(.+?)\s*-->/g;
  const matches = [...html.matchAll(includeRe)];
  for (const match of matches) {
    const componentPath = join(COMPONENTS_DIR, match[1].trim());
    const file = Bun.file(componentPath);
    const content = (await file.exists()) ? await file.text() : `<!-- missing: ${match[1].trim()} -->`;
    const rendered = fillTemplate(await renderAssetUrls(content), values);
    html = html.replace(match[0], () => rendered);
  }
  return html;
}

export async function renderPage(pathname: string, lang: Lang, req?: Request): Promise<Response | null> {
  // Legacy links must redirect before conditional page revalidation can return 304.
  if (pathname === '/cv') {
    const search = req ? new URL(req.url).search : '';
    return new Response(null, { status: 308, headers: { Location: `/resume${search}` } });
  }

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

  const content = await resolveIncludes(await renderAssetUrls(await fragment.text()), {
    ...terminalBodyCopy(lang),
    terminalFullscreenButton: pathname === '/' ? await renderTerminalFullscreenButton(lang) : '',
    resumeBadge: `[${t(lang, 'navResume')}]`,
    downloadResume: t(lang, 'footerResumeLink'),
  });
  const html = await renderLayout(config, content, lang);

  if (!cacheable) {
    const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
    if (req?.method === 'HEAD') {
      headers.set('Content-Length', String(Buffer.byteLength(html)));
      return new Response(null, { headers });
    }
    return new Response(html, { headers });
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

  // Decode first so encoded and decoded legacy filenames share all asset semantics.
  if (relativePath === 'Begench Geldyev(CV).pdf') {
    relativePath = 'Begench-Geldyev-Resume.pdf';
  }

  const assetPath = normalize(join(PUBLIC_DIR, relativePath));
  const inPublicDir = assetPath === PUBLIC_DIR || assetPath.startsWith(`${PUBLIC_DIR}${sep}`);
  if (!inPublicDir) {
    return new Response('Forbidden', { status: 403 });
  }

  if (/\.[a-f0-9]{64}\.(css|js)$/.test(relativePath)) {
    const asset = await contentAssets.get(`/public/${relativePath}`);
    if (!asset) return new Response('Not Found', { status: 404 });
    return assetResponse(
      asset.body,
      new Headers({
        'Cache-Control': CONTENT_CACHE_CONTROL,
        'Content-Type': asset.body.type,
        ETag: asset.etag,
      }),
      req,
    );
  }

  const file = Bun.file(assetPath);
  if (!(await file.exists())) {
    return new Response('Not Found', { status: 404 });
  }

  const extension = extname(assetPath);
  const meta = await assetMeta(assetPath, file.size);
  const headers = new Headers({
    'Cache-Control': LONG_LIVED_EXTENSIONS.has(extension) ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL,
    'Content-Type': MIME[extension] ?? 'application/octet-stream',
    ETag: meta.etag,
  });
  if (meta.lastModified) {
    headers.set('Last-Modified', meta.lastModified);
  }

  return assetResponse(file, headers, req);
}
