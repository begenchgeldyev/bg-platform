import { extname, join, normalize, sep } from 'node:path';
import { type Lang, localizedFragmentFile, t } from './i18n';

type NavKey = 'projects' | 'logs' | 'cv';
type FooterVariant = 'default' | 'home';

type PageConfig = {
  title: Record<Lang, string>;
  fragmentFile: string;
  activeNav?: NavKey;
  brandIsLink?: boolean;
  footerVariant?: FooterVariant;
  includeCvLink?: boolean;
  selectionTextClass?: string;
  showTerminalIcon?: boolean;
};

function serializeForInlineScript(value: unknown) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const APP_DIR = import.meta.dir;
const PAGES_DIR = join(APP_DIR, 'pages');
const COMPONENTS_DIR = join(APP_DIR, 'components');
const PUBLIC_DIR = join(APP_DIR, 'public');
const templateCache = new Map<string, Promise<string>>();

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

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

async function renderSharedHead(userEmail?: string | null) {
  const serializedEmail = serializeForInlineScript(userEmail ?? null);
  return renderComponentTemplate('shared-head.html', { serializedEmailAttr: escapeHtml(serializedEmail) });
}

function renderNavLink(activeNav: NavKey | undefined, href: string, label: string, key: NavKey) {
  const isActive = activeNav === key;
  const classes = isActive
    ? 'font-label uppercase tracking-widest text-xs font-semibold text-primary-container border-b-2 border-primary-container pb-1'
    : 'font-label uppercase tracking-widest text-xs font-semibold text-white/80 hover:text-primary-container transition-colors';
  const current = isActive ? ' aria-current="page"' : '';
  return `<a class="${classes}" href="${href}"${current}>${label}</a>`;
}

async function renderHeader(config: PageConfig, lang: Lang) {
  const brand = config.brandIsLink
    ? `<a href="/" class="text-[#00FF41] font-mono font-bold tracking-widest text-sm hover:opacity-80 transition-opacity">
      begench@127.0.0.1
    </a>`
    : `<div class="text-[#00FF41] font-mono font-bold tracking-widest text-sm">
      begench@127.0.0.1 <span class="hidden sm:inline opacity-60">WHOAMI</span>
    </div>`;

  const terminal = config.showTerminalIcon
    ? `<span class="material-symbols-outlined cursor-pointer hover:text-primary-container transition-colors">terminal</span>`
    : '';

  const langButtons = (['en', 'ru'] as const)
    .map((code) => {
      const active = code === lang;
      const classes = active ? 'text-primary-container font-semibold' : 'text-white/80 hover:text-primary-container transition-colors';
      return `<button type="button" data-lang="${code}" aria-pressed="${active}" class="${classes}">${code}</button>`;
    })
    .join('<span class="text-outline-variant/60" aria-hidden="true">|</span>');

  const langToggle = `<div class="flex items-center gap-2 font-mono text-xs uppercase tracking-widest" role="group" aria-label="${t(lang, 'langToggleLabel')}">${langButtons}</div>
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

async function renderFooter(config: PageConfig, lang: Lang) {
  if (config.footerVariant === 'home') {
    return renderComponentTemplate('footer-home.html');
  }

  const cvLink = config.includeCvLink
    ? `<a class="font-mono text-xs tracking-widest text-primary-container underline font-bold uppercase" href="/public/Begench%20Geldyev(CV).pdf" target="_blank">${t(lang, 'footerCvLink')}</a>`
    : '';

  return renderComponentTemplate('footer-default.html', { cvLink });
}

async function renderLayout(config: PageConfig, content: string, lang: Lang, userEmail?: string | null) {
  const selectionTextClass = config.selectionTextClass ?? 'selection:text-on-primary-container';
  return renderComponentTemplate('document.html', {
    content,
    footer: await renderFooter(config, lang),
    header: await renderHeader(config, lang),
    lang,
    selectionTextClass,
    sharedHead: await renderSharedHead(userEmail),
    title: config.title[lang],
  });
}

export async function renderDocument(config: PageConfig, content: string, lang: Lang, userEmail?: string | null) {
  return renderLayout(config, content, lang, userEmail);
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

export async function renderPage(pathname: string, lang: Lang, userEmail?: string | null): Promise<Response | null> {
  const config = PAGE_CONFIGS[pathname];
  if (!config) {
    return null;
  }

  const localized = Bun.file(join(PAGES_DIR, localizedFragmentFile(config.fragmentFile, lang)));
  const fallback = Bun.file(join(PAGES_DIR, config.fragmentFile));
  const fragment = (await localized.exists()) ? localized : fallback;

  if (!(await fragment.exists())) {
    return new Response('Not Found', { status: 404 });
  }

  const content = await resolveIncludes(await fragment.text());
  return new Response(await renderLayout(config, content, lang, userEmail), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function servePublicAsset(pathname: string): Promise<Response> {
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

  return new Response(file, {
    headers: { 'Content-Type': MIME[extname(assetPath)] ?? 'application/octet-stream' },
  });
}
