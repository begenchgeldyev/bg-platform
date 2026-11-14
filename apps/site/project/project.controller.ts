import { Injectable, type Project, type ProjectAccessResolver, type ProjectsRepository } from '@bg/core';
import { errorResponse, readJsonWithin, refuseCrossSite, refuseNonJson } from '../http/requests';
import { type Lang, resolveLang, t } from '../i18n';
import { renderComponentTemplate, renderDynamicPage } from '../site';
import { type ProjectArt, projectArt } from './project-art';
import { projectIcon } from './project-icons';
import { PROJECT_LIMITS, parseNewProject, parseProjectChanges } from './project-input';

export type ProjectControllerRepository = Pick<ProjectsRepository, 'list' | 'findById' | 'create' | 'updateById' | 'deleteById'>;

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function formatProjectDate(value: Date | null, lang: Lang) {
  if (!value) {
    return t(lang, 'dateUnknown');
  }

  return new Intl.DateTimeFormat(t(lang, 'dateLocale'), {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(value);
}

function serializeForScript(value: unknown) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

async function renderContentHtml(value: string | null) {
  const content = value?.trim();
  if (!content) {
    return renderComponentTemplate('projects/content-empty.html');
  }

  return content;
}

function renderCoverTags(tags: string[], lang: Lang) {
  if (tags.length === 0) {
    return '';
  }

  return `<ul class="project-technologies" aria-label="${lang === 'ru' ? 'Технологии' : 'Technologies'}">${tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join('')}</ul>`;
}

function renderPlainTags(tags: string[]) {
  if (tags.length === 0) {
    return '';
  }

  const chips = tags
    .map((tag) => {
      return `<span class="text-[9px] font-mono font-bold border border-outline-variant/60 bg-surface/40 px-2 py-1 text-on-surface-variant uppercase">${escapeHtml(tag)}</span>`;
    })
    .join('');

  return `<div class="flex flex-wrap gap-2 pt-2">${chips}</div>`;
}

function renderHiddenBadge(isHidden: boolean, lang: Lang, projectId: number) {
  if (!isHidden) {
    return '';
  }

  return `<span id="project-visibility-${projectId}" class="inline-flex items-center px-2 py-0.5 bg-secondary/10 text-secondary border border-secondary/30 text-[10px] font-mono font-bold uppercase tracking-wider">${escapeHtml(t(lang, 'visibilityHidden'))}</span>`;
}

const CARD_COVER_SIZES = '(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 384px';
const DETAIL_COVER_SIZES = '(max-width: 767px) 100vw, 768px';

// Format sources are always wrapped in <picture>: the cover box positions that element.
function renderArtSources(art: ProjectArt, sizes: string, lazy: boolean) {
  const attribute = lazy ? 'data-srcset' : 'srcset';
  const formats = [
    ['avif', art.avif],
    ['webp', art.webp],
  ] as const;
  return formats
    .map(([format, srcset]) =>
      srcset ? `<source type="image/${format}" sizes="${sizes}" ${attribute}="${escapeHtml(srcset)}">\n        ` : '',
    )
    .join('');
}

async function renderProjectCard(project: Project, lang: Lang) {
  const name = escapeHtml(project.name);
  const description = escapeHtml(project.description?.trim() || t(lang, 'projectNoDescription'));
  const art = projectArt(project.image);
  const viewProjectText = escapeHtml(t(lang, 'viewProject'));
  const tags = project.tags;
  const hiddenBadge = renderHiddenBadge(project.isHidden, lang, project.id);
  // Sources are activated near the viewport: native lazy-loading alone may fetch all
  // three originals on mobile. The gallery's observer also handles HTMX swaps.
  const pictureHtml = art
    ? `<picture>
        ${renderArtSources(art, CARD_COVER_SIZES, true)}<img data-project-cover${art.motion ? ` data-project-motion="${escapeHtml(art.motion.card)}"` : ''} data-src="${escapeHtml(art.image)}" width="${art.width}" height="${art.height}" loading="lazy" decoding="async" alt="">
      </picture>`
    : '';

  return renderComponentTemplate('projects/card.html', {
    description,
    hiddenBadge,
    visibilityDescription: project.isHidden ? `aria-describedby="project-visibility-${project.id}"` : '',
    icon: escapeHtml(projectIcon(project)),
    name,
    pictureHtml,
    projectId: String(project.id),
    projectHref: `/projects/${project.id}`,
    tagsHtml: renderCoverTags(tags, lang),
    viewProjectText,
  });
}

async function renderProjectsFragment(projects: Project[], lang: Lang) {
  if (projects.length === 0) {
    return renderComponentTemplate('projects/empty-state.html', {
      emptyTitle: lang === 'ru' ? 'Пока нет опубликованных проектов' : 'No published projects yet',
      emptyDescription: lang === 'ru' ? 'Новые проекты появятся здесь.' : 'There are no published entries to display yet.',
    });
  }

  return (await Promise.all(projects.map((project) => renderProjectCard(project, lang)))).join('');
}

async function renderProjectEditor() {
  return renderComponentTemplate('projects/editor.html');
}

async function renderProjectEditorScript(project: Project) {
  const state = serializeForScript({
    id: project.id,
    name: project.name,
    description: project.description ?? '',
    content: project.content ?? '',
    image: project.image ?? '',
    isHidden: project.isHidden,
  });

  return renderComponentTemplate('projects/editor-script.html', {
    projectMode: escapeHtml(state),
    projectLimits: escapeHtml(serializeForScript({ maxImageBytes: PROJECT_LIMITS.maxImageBytes })),
    emptyContentHtmlAttr: escapeHtml(await renderComponentTemplate('projects/content-empty.html')),
  });
}

async function renderProjectPage(req: Request, project: Project, canEdit: boolean) {
  const lang = resolveLang(req);
  const description = project.description?.trim() || t(lang, 'projectNoDescription');
  const image = project.image?.trim();
  const createdAt = formatProjectDate(project.createdAt, lang);
  const updatedAt = formatProjectDate(project.updatedAt, lang);
  const visibility = project.isHidden ? t(lang, 'visibilityHidden') : t(lang, 'visibilityPublished');
  const adminControls = canEdit
    ? `<div class="space-y-3 border border-primary-container/30 bg-primary-container/5 p-4">
        <div class="font-mono text-[11px] uppercase tracking-[0.18em] text-primary-container">[ADMIN]</div>
        <div class="flex flex-wrap gap-3">
          <button
            id="project-upload-trigger"
            type="button"
            class="border border-outline-variant/30 px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-on-surface hover:border-primary-container hover:text-primary-container">
            Upload Image
          </button>
          <button
            id="project-visibility-toggle"
            type="button"
            class="border border-outline-variant/30 px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-on-surface hover:border-primary-container hover:text-primary-container">
            ${project.isHidden ? 'Publish Project' : 'Hide Project'}
          </button>
        </div>
        <input id="project-upload-input" type="file" accept="image/*" class="hidden" />
        <div id="project-admin-status" class="font-mono text-xs text-on-surface-variant"></div>
      </div>`
    : '';
  const art = projectArt(image);
  const previewAlt = `${escapeHtml(project.name)} preview`;
  // Known artwork has a 4:3 master; arbitrary uploads keep their own natural ratio.
  const previewSize = art?.avif ? ` width="${art.width}" height="${art.height}"` : '';
  const imageBlock = art
    ? `<div class="overflow-hidden border border-outline-variant/30 bg-surface" ${canEdit ? 'data-admin-editable="image"' : ''}>
        <picture>${canEdit ? '' : `\n        ${renderArtSources(art, DETAIL_COVER_SIZES, false)}`}<img data-project-preview${!canEdit && art.motion ? ` data-project-motion="${escapeHtml(art.motion.page)}"` : ''} class="max-h-[520px] w-full object-cover" src="${escapeHtml(art.image)}"${previewSize} fetchpriority="high" decoding="async" alt="${previewAlt}"></picture>
      </div>`
    : `<div class="overflow-hidden border border-outline-variant/30 bg-surface" hidden>
        <img data-project-preview class="max-h-[520px] w-full object-cover" src="" alt="${previewAlt}"/>
      </div>`;
  const contentHtml = await renderComponentTemplate('projects/page.html', {
    adminControls,
    content: await renderContentHtml(project.content),
    createdAt: escapeHtml(createdAt),
    description: escapeHtml(description),
    editor: canEdit ? `${await renderProjectEditor()}${await renderProjectEditorScript(project)}` : '',
    headerEditableAttrs: canEdit ? 'data-admin-editable="header"' : '',
    contentEditableAttrs: canEdit ? 'data-admin-editable="content"' : '',
    imageBlock,
    imageMotion: await renderComponentTemplate('projects/image-motion.html'),
    projectId: String(project.id),
    projectName: escapeHtml(project.name),
    route: `/projects/${project.id}`,
    tagsHtml: renderPlainTags(project.tags),
    updatedAt: escapeHtml(updatedAt),
    visibility: escapeHtml(visibility),
  });

  return renderDynamicPage(req, {
    page: 'project',
    title: `${project.name.toUpperCase()} — BEGENCH_GELDYEV@ROOT:~$`,
    contentHtml,
  });
}

function projectNotFound(req: Request) {
  return new Response(req.method === 'HEAD' ? null : 'Not Found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': String(Buffer.byteLength('Not Found')),
    },
  });
}

@Injectable()
export class ProjectController {
  constructor(
    private readonly projectsRepository: ProjectControllerRepository,
    private readonly projectAccess: ProjectAccessResolver,
  ) {}

  async get(req: Request) {
    const items = await this.projectsRepository.list({ includeHidden: (await this.projectAccess(req)) === 'editor' });
    if (req.headers.get('HX-Request') === 'true') {
      return new Response(await renderProjectsFragment(items, resolveLang(req)), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return Response.json({ projects: items });
  }

  // Writes share one guard order: cross-site, then edit rights, then JSON-only, then a
  // size-limited JSON read. Callers only have to deal with the parsed body or an early response.
  private async readAuthorizedJson(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
    const crossSite = refuseCrossSite(req);
    if (crossSite) {
      return { ok: false, response: crossSite };
    }

    if ((await this.projectAccess(req)) !== 'editor') {
      return { ok: false, response: errorResponse(403, 'not allowed') };
    }

    const nonJson = refuseNonJson(req);
    if (nonJson) {
      return { ok: false, response: nonJson };
    }

    return readJsonWithin(req, PROJECT_LIMITS.maxBodyBytes);
  }

  async post(req: Request) {
    const body = await this.readAuthorizedJson(req);
    if (!body.ok) {
      return body.response;
    }

    const parsed = parseNewProject(body.value);
    if (!parsed.ok) {
      return errorResponse(400, parsed.error);
    }

    const created = await this.projectsRepository.create(parsed.value);
    return Response.json({ project: created }, { status: 201 });
  }

  async patch(req: Request, id: number) {
    const body = await this.readAuthorizedJson(req);
    if (!body.ok) {
      return body.response;
    }

    const parsed = parseProjectChanges(body.value);
    if (!parsed.ok) {
      return errorResponse(400, parsed.error);
    }

    const updated = await this.projectsRepository.updateById(id, parsed.value);
    if (!updated) {
      return errorResponse(404, 'project not found');
    }

    return Response.json({ project: updated });
  }

  async delete(req: Request, id: number) {
    const crossSite = refuseCrossSite(req);
    if (crossSite) {
      return crossSite;
    }

    if ((await this.projectAccess(req)) !== 'editor') {
      return errorResponse(403, 'not allowed');
    }

    const deleted = await this.projectsRepository.deleteById(id);
    if (!deleted) {
      return errorResponse(404, 'project not found');
    }

    return new Response(null, { status: 204 });
  }

  async getPageById(req: Request, id: number) {
    const project = await this.projectsRepository.findById(id);
    if (!project) {
      return projectNotFound(req);
    }

    const allowEdit = (await this.projectAccess(req)) === 'editor';
    if (project.isHidden && !allowEdit) {
      return projectNotFound(req);
    }

    return await renderProjectPage(req, project, allowEdit);
  }
}
