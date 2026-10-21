import { Injectable, type ProjectsRepository } from '@bg/core';
import { errorResponse, readJsonWithin, refuseCrossSite, refuseNonJson } from '../http/requests';
import { type Lang, resolveLang, t } from '../i18n';
import { renderComponentTemplate, renderDocument } from '../site';
import { cardColSpans } from './card-layout';
import { projectIcon } from './project-icons';
import { PROJECT_LIMITS, parseNewProject, parseProjectChanges } from './project-input';

type ProjectRecord = Awaited<ReturnType<ProjectsRepository['list']>>[number];

export type CanEditProjects = (req: Request) => Promise<boolean>;

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

function renderPhotoTags(tags: string[]) {
  if (tags.length === 0) {
    return '';
  }

  const chips = tags
    .map((tag, index) => {
      const escapedTag = escapeHtml(tag);
      if (index === 0) {
        return `<span class="px-2 py-1 bg-primary-container text-on-primary-container text-[10px] font-mono font-bold uppercase">${escapedTag}</span>`;
      }
      return `<span class="px-2 py-1 bg-white/10 text-white text-[10px] font-mono font-bold uppercase backdrop-blur-md border border-white/10">${escapedTag}</span>`;
    })
    .join('');

  return `<div class="flex flex-wrap gap-2 mb-4">${chips}</div>`;
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

function renderHiddenBadge(isHidden: boolean, lang: Lang) {
  if (!isHidden) {
    return '';
  }

  return `<span class="inline-flex items-center px-2 py-0.5 bg-secondary/10 text-secondary border border-secondary/30 text-[10px] font-mono font-bold uppercase tracking-wider">${escapeHtml(t(lang, 'visibilityHidden'))}</span>`;
}

async function renderProjectCard(project: ProjectRecord, index: number, total: number, lang: Lang) {
  const colSpan = cardColSpans(total)[index] ?? 12;
  const colSpanClass = `md:col-span-${colSpan}`;
  const name = escapeHtml(project.name);
  const description = escapeHtml(project.description?.trim() || t(lang, 'projectNoDescription'));
  const image = project.image?.trim();
  const viewProjectText = escapeHtml(t(lang, 'viewProject'));
  const tags = project.tags;
  const hiddenBadge = renderHiddenBadge(project.isHidden, lang);
  const isWide = colSpan === 12;

  if (image) {
    return renderComponentTemplate(isWide ? 'projects/card-photo-wide.html' : 'projects/card-photo.html', {
      colSpanClass,
      description,
      hiddenBadge,
      image: escapeHtml(image),
      name,
      projectHref: `/projects/${project.id}`,
      tagsHtml: renderPhotoTags(tags),
      viewProjectText,
    });
  }

  return renderComponentTemplate(isWide ? 'projects/card-plain-wide.html' : 'projects/card-plain.html', {
    colSpanClass,
    description,
    hiddenBadge,
    icon: escapeHtml(projectIcon(project)),
    name,
    projectHref: `/projects/${project.id}`,
    tagsHtml: renderPlainTags(tags),
    viewProjectText,
  });
}

async function renderProjectsFragment(projects: ProjectRecord[], lang: Lang) {
  if (projects.length === 0) {
    return renderComponentTemplate('projects/empty-state.html');
  }

  return (await Promise.all(projects.map((project, index) => renderProjectCard(project, index, projects.length, lang)))).join('');
}

async function renderProjectEditor() {
  return renderComponentTemplate('projects/editor.html');
}

async function renderProjectEditorScript(project: ProjectRecord) {
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
    emptyContentHtmlAttr: escapeHtml(await renderComponentTemplate('projects/content-empty.html')),
  });
}

async function renderProjectPage(req: Request, project: ProjectRecord, canEdit: boolean) {
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
  const imageBlock = image
    ? `<div class="overflow-hidden border border-outline-variant/30 bg-surface" ${canEdit ? 'data-admin-editable="image"' : ''}>
        <img data-project-preview class="max-h-[520px] w-full object-cover" src="${escapeHtml(image)}" alt="${escapeHtml(project.name)} preview"/>
      </div>`
    : `<div class="overflow-hidden border border-outline-variant/30 bg-surface" hidden>
        <img data-project-preview class="max-h-[520px] w-full object-cover" src="" alt="${escapeHtml(project.name)} preview"/>
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
    projectId: String(project.id),
    projectName: escapeHtml(project.name),
    route: `/projects/${project.id}`,
    tagsHtml: renderPlainTags(project.tags),
    updatedAt: escapeHtml(updatedAt),
    visibility: escapeHtml(visibility),
  });

  const projectTitle = `${escapeHtml(project.name.toUpperCase())} — BEGENCH_GELDYEV@ROOT:~$`;

  return new Response(
    await renderDocument(
      {
        title: { en: projectTitle, ru: projectTitle },
        fragmentFile: 'projects.html',
        activeNav: 'projects',
        brandIsLink: true,
        footerVariant: 'default',
        showTerminalIcon: true,
      },
      contentHtml,
      lang,
    ),
    {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    },
  );
}

@Injectable()
export class ProjectController {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly canEditProjects: CanEditProjects,
  ) {}

  async get(req: Request) {
    const items = await this.projectsRepository.list({ includeHidden: await this.canEditProjects(req) });
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

    if (!(await this.canEditProjects(req))) {
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

    if (!(await this.canEditProjects(req))) {
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
      return new Response('Not Found', { status: 404 });
    }

    const allowEdit = await this.canEditProjects(req);
    if (project.isHidden && !allowEdit) {
      return new Response('Not Found', { status: 404 });
    }

    return await renderProjectPage(req, project, allowEdit);
  }
}
