import { canAccess, Injectable, type ProjectsRepository, resolveEmail } from '@bg/core';
import { type Lang, resolveLang, t } from '../i18n';
import { renderComponentTemplate, renderDocument } from '../site';
import { cardColSpans } from './card-layout';
import { extractStackTags } from './stack-tags';

type ProjectRecord = Awaited<ReturnType<ProjectsRepository['list']>>[number];

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

function getProjectIcon(name: string, description: string): string {
  const text = `${name} ${description}`.toLowerCase();
  if (/\bbot\b/.test(text)) return 'smart_toy';
  if (/\bweb|\bsite\b|\bportfolio\b|\bblog\b/.test(text)) return 'web';
  return 'terminal';
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
  const tags = extractStackTags(project.content);
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
    icon: escapeHtml(getProjectIcon(project.name, project.description ?? '')),
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
    updatedAt: escapeHtml(updatedAt),
    visibility: escapeHtml(visibility),
  });

  const projectTitle = `${project.name.toUpperCase()} — BEGENCH_GELDYEV@ROOT:~$`;

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
      resolveEmail(req),
    ),
    {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    },
  );
}

async function parseProjectPayload(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) };
  }

  if (!body || typeof body !== 'object') {
    return { error: Response.json({ error: 'Body must be a JSON object' }, { status: 400 }) };
  }

  const payload = body as Record<string, unknown>;
  if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
    return { error: Response.json({ error: 'name is required' }, { status: 400 }) };
  }

  return {
    value: {
      name: payload.name.trim(),
      description: typeof payload.description === 'string' ? payload.description : null,
      content: typeof payload.content === 'string' ? payload.content : null,
      image: typeof payload.image === 'string' ? payload.image : null,
      isHidden: typeof payload.isHidden === 'boolean' ? payload.isHidden : false,
    },
  };
}

@Injectable()
export class ProjectController {
  constructor(private readonly projectsRepository: ProjectsRepository) {}

  async get(req: Request) {
    const items = await this.projectsRepository.list();
    if (req.headers.get('HX-Request') === 'true') {
      return new Response(await renderProjectsFragment(items, resolveLang(req)), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return Response.json({ projects: items });
  }

  async post(req: Request) {
    const parsed = await parseProjectPayload(req);
    if ('error' in parsed) {
      return parsed.error;
    }

    const [created] = await this.projectsRepository.create({
      ...parsed.value,
    });

    return Response.json({ project: created }, { status: 201 });
  }

  async patch(req: Request, id: number) {
    const parsed = await parseProjectPayload(req);
    if ('error' in parsed) {
      return parsed.error;
    }

    const [updated] = await this.projectsRepository.updateById(id, parsed.value);
    if (!updated) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    return Response.json({ project: updated });
  }

  async getPageById(req: Request, id: number) {
    const project = await this.projectsRepository.findById(id);
    if (!project) {
      return new Response('Not Found', { status: 404 });
    }

    const allowEdit = await canAccess(req, {
      actions: 'update',
      resource: 'project',
      resourceAttributes: { projectId: project.id },
    });

    return await renderProjectPage(req, project, allowEdit);
  }
}
