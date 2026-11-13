import { describe, expect, test } from 'bun:test';
import type { ProjectInput, ProjectsRepository } from '@bg/core';
import { ProjectController } from './project.controller';

type Project = Awaited<ReturnType<ProjectsRepository['list']>>[number];

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: 'Demo',
    description: null,
    content: null,
    image: null,
    isHidden: false,
    icon: null,
    tags: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

class FakeProjectsRepository {
  calls: string[] = [];
  created: ProjectInput[] = [];
  updates: { id: number; changes: Partial<ProjectInput> }[] = [];

  constructor(private projects: Project[] = []) {}

  async list({ includeHidden }: { includeHidden: boolean }): Promise<Project[]> {
    this.calls.push(`list:${includeHidden}`);
    return includeHidden ? this.projects : this.projects.filter((item) => !item.isHidden);
  }

  async findById(id: number): Promise<Project | null> {
    this.calls.push(`findById:${id}`);
    return this.projects.find((item) => item.id === id) ?? null;
  }

  async create(input: ProjectInput): Promise<Project> {
    this.calls.push('create');
    this.created.push(input);
    const created = project({ ...input, id: this.projects.length + 10 });
    this.projects.push(created);
    return created;
  }

  async updateById(id: number, changes: Partial<ProjectInput>): Promise<Project | null> {
    this.calls.push(`updateById:${id}`);
    this.updates.push({ id, changes });
    const existing = this.projects.find((item) => item.id === id);
    if (!existing) return null;
    return { ...existing, ...changes, updatedAt: new Date('2026-02-01T00:00:00Z') };
  }

  async deleteById(id: number): Promise<boolean> {
    this.calls.push(`deleteById:${id}`);
    const index = this.projects.findIndex((item) => item.id === id);
    if (index === -1) return false;
    this.projects.splice(index, 1);
    return true;
  }
}

function controller(options: { projects?: Project[]; canEdit?: boolean } = {}) {
  const repository = new FakeProjectsRepository(options.projects ?? []);
  const canEditCalls: Request[] = [];
  const canEdit = async (req: Request) => {
    canEditCalls.push(req);
    return options.canEdit ?? false;
  };
  const subject = new ProjectController(repository as unknown as ProjectsRepository, canEdit);

  return { canEditCalls, controller: subject, repository };
}

function jsonWrite(body: unknown, options: { method?: 'POST' | 'PATCH'; id?: number; headers?: Record<string, string> } = {}): Request {
  const { method = 'POST', id, headers = {} } = options;
  return new Request(`http://localhost/api/projects${id === undefined ? '' : `/${id}`}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function deleteRequest(headers: Record<string, string> = {}, id = 1): Request {
  return new Request(`http://localhost/api/projects/${id}`, { method: 'DELETE', headers });
}

function hxList(): Request {
  return new Request('http://localhost/api/projects', { headers: { 'HX-Request': 'true' } });
}

const HIDDEN = 'Secret Project';

function projectsWithHidden(): Project[] {
  return [project({ id: 1, name: 'Visible Project' }), project({ id: 2, name: HIDDEN, isHidden: true })];
}

describe('ProjectController.get', () => {
  test('hides hidden projects from visitors', async () => {
    const visitor = controller({ projects: projectsWithHidden(), canEdit: false });
    const visitorHtml = await (await visitor.controller.get(hxList())).text();
    expect(visitorHtml).toContain('Visible Project');
    expect(visitorHtml).not.toContain(HIDDEN);

    const owner = controller({ projects: projectsWithHidden(), canEdit: true });
    const ownerHtml = await (await owner.controller.get(hxList())).text();
    expect(ownerHtml).toContain('Visible Project');
    expect(ownerHtml).toContain(HIDDEN);
    expect(ownerHtml).toContain('Hidden');
  });

  test('the JSON list follows the same rule', async () => {
    const visitor = controller({ projects: projectsWithHidden(), canEdit: false });
    const visitorJson = (await (await visitor.controller.get(new Request('http://localhost/api/projects'))).json()) as {
      projects: Project[];
    };
    expect(visitorJson.projects.map((item) => item.name)).toEqual(['Visible Project']);

    const owner = controller({ projects: projectsWithHidden(), canEdit: true });
    const ownerJson = (await (await owner.controller.get(new Request('http://localhost/api/projects'))).json()) as {
      projects: Project[];
    };
    expect(ownerJson.projects.map((item) => item.name)).toEqual(['Visible Project', HIDDEN]);
  });
});

describe('ProjectController.getPageById', () => {
  test("a hidden project's page is 404 for visitors and 200 for the owner", async () => {
    const visitor = controller({ projects: projectsWithHidden(), canEdit: false });
    const notFound = await visitor.controller.getPageById(new Request('http://localhost/projects/2'), 2);
    expect(notFound.status).toBe(404);

    const owner = controller({ projects: projectsWithHidden(), canEdit: true });
    const found = await owner.controller.getPageById(new Request('http://localhost/projects/2'), 2);
    expect(found.status).toBe(200);
  });

  test('a missing project is 404 for everyone', async () => {
    const owner = controller({ projects: projectsWithHidden(), canEdit: true });
    const response = await owner.controller.getPageById(new Request('http://localhost/projects/99'), 99);
    expect(response.status).toBe(404);
  });

  test('escapes the project name in the page title', async () => {
    const name = '</title><script>alert(1)</script>';
    const subject = controller({ projects: [project({ id: 1, name })], canEdit: false });
    const html = await (await subject.controller.getPageById(new Request('http://localhost/projects/1'), 1)).text();

    expect(html).toContain('&lt;/TITLE&gt;&lt;SCRIPT&gt;ALERT(1)&lt;/SCRIPT&gt;');
    expect(html).not.toContain('</TITLE><SCRIPT>');
    expect(html).not.toContain('<SCRIPT>ALERT');
  });

  test('renders tag chips when project has tags, and nothing when empty', async () => {
    const withTags = controller({
      projects: [project({ id: 1, tags: ['TypeScript', 'Bun'] })],
      canEdit: false,
    });
    const resWithTags = await withTags.controller.getPageById(new Request('http://localhost/projects/1'), 1);
    const htmlWithTags = await resWithTags.text();
    expect(htmlWithTags).toContain('TypeScript');
    expect(htmlWithTags).toContain('Bun');

    const noTags = controller({
      projects: [project({ id: 2, tags: [] })],
      canEdit: false,
    });
    const resNoTags = await noTags.controller.getPageById(new Request('http://localhost/projects/2'), 2);
    const htmlNoTags = await resNoTags.text();
    expect(htmlNoTags).not.toContain('TypeScript');
    expect(htmlNoTags).not.toContain('<span class="text-[9px]');
  });
});

describe('ProjectController writes', () => {
  test('refuses writes from visitors', async () => {
    const { controller: subject, repository } = controller({ projects: [project()], canEdit: false });

    const responses = [
      await subject.post(jsonWrite({ name: 'Demo' })),
      await subject.patch(jsonWrite({ name: 'Demo' }, { method: 'PATCH', id: 1 }), 1),
      await subject.delete(deleteRequest(), 1),
    ];

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    const errors = await Promise.all(responses.map(async (response) => ((await response.json()) as { error: string }).error));
    expect(errors).toEqual(['not allowed', 'not allowed', 'not allowed']);
    expect(repository.calls).toEqual([]);
  });

  test('refuses cross-site writes before anything else', async () => {
    const crossSite = { 'Sec-Fetch-Site': 'cross-site' };
    const { canEditCalls, controller: subject, repository } = controller({ canEdit: true });

    const posted = await subject.post(jsonWrite({ name: 'Demo' }, { headers: crossSite }));
    const deleted = await subject.delete(deleteRequest(crossSite), 1);

    expect(posted.status).toBe(403);
    expect(((await posted.json()) as { error: string }).error).toBe('cross-site requests are not allowed');
    expect(deleted.status).toBe(403);
    expect(((await deleted.json()) as { error: string }).error).toBe('cross-site requests are not allowed');
    expect(canEditCalls).toHaveLength(0);
    expect(repository.calls).toEqual([]);
  });

  test('refuses non-JSON writes from the owner', async () => {
    const { controller: subject, repository } = controller({ canEdit: true });
    const response = await subject.post(
      new Request('http://localhost/api/projects', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }),
    );

    expect(response.status).toBe(415);
    expect(repository.calls).toEqual([]);
  });

  test('creates a project from valid input', async () => {
    const { controller: subject, repository } = controller({ canEdit: true });
    const response = await subject.post(jsonWrite({ name: '  Demo  ', tags: [' Go '] }));

    expect(response.status).toBe(201);
    expect(repository.created).toEqual([
      { name: 'Demo', description: null, content: null, image: null, isHidden: false, icon: null, tags: ['Go'] },
    ]);
    expect(((await response.json()) as { project: Project }).project.name).toBe('Demo');
  });

  test('rejects invalid input readably', async () => {
    const { controller: subject, repository } = controller({ canEdit: true });
    const response = await subject.post(jsonWrite({}));

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('name is required');
    expect(repository.calls).toEqual([]);
  });

  test('PATCH changes only the fields it receives', async () => {
    const { controller: subject, repository } = controller({ projects: [project({ icon: 'database', tags: ['Go'] })], canEdit: true });
    const response = await subject.patch(
      jsonWrite(
        { name: 'Telegram Bot v2', description: 'A bot', image: '', content: '<p>Body</p>', isHidden: false },
        { method: 'PATCH', id: 1 },
      ),
      1,
    );

    expect(response.status).toBe(200);
    expect(repository.updates).toHaveLength(1);
    expect(repository.updates[0]?.id).toBe(1);
    expect(Object.keys(repository.updates[0]?.changes ?? {}).sort()).toEqual(['content', 'description', 'image', 'isHidden', 'name']);
    expect(repository.updates[0]?.changes).toEqual({
      name: 'Telegram Bot v2',
      description: 'A bot',
      image: null,
      content: '<p>Body</p>',
      isHidden: false,
    });
  });

  test('a photo over 2 MB is refused and nothing is saved', async () => {
    const { controller: subject, repository } = controller({ projects: [project()], canEdit: true });
    const response = await subject.patch(
      jsonWrite({ image: `data:image/png;base64,${'A'.repeat(2_796_204)}` }, { method: 'PATCH', id: 1 }),
      1,
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('photo must be 2 MB or smaller');
    expect(repository.updates).toHaveLength(0);
  });

  test('patching or deleting a missing project is 404 project not found', async () => {
    const { controller: subject } = controller({ canEdit: true });

    const patched = await subject.patch(jsonWrite({ name: 'Demo' }, { method: 'PATCH', id: 99 }), 99);
    expect(patched.status).toBe(404);
    expect(((await patched.json()) as { error: string }).error).toBe('project not found');

    const deleted = await subject.delete(deleteRequest({}, 99), 99);
    expect(deleted.status).toBe(404);
    expect(((await deleted.json()) as { error: string }).error).toBe('project not found');
  });

  test('deletes a project', async () => {
    const { controller: subject, repository } = controller({ projects: [project({ id: 1 })], canEdit: true });
    const response = await subject.delete(deleteRequest(), 1);

    expect(response.status).toBe(204);
    expect(await repository.findById(1)).toBeNull();
  });
});

describe('project cards', () => {
  test('hidden owner cards describe their visibility without changing public link names', async () => {
    const subject = controller({ projects: projectsWithHidden(), canEdit: true });
    const html = await (await subject.controller.get(hxList())).text();
    expect(html).toContain('id="project-visibility-2"');
    expect(html).toContain('aria-describedby="project-visibility-2"');
    expect(html).not.toContain('aria-describedby="project-visibility-1"');
    expect(html).toContain('aria-labelledby="project-title-1 project-action-1"');
  });

  test('the empty result can receive retry focus without adding a Tab stop', async () => {
    const html = await (await controller().controller.get(hxList())).text();
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toContain('tabindex="0"');
  });

  test('uses the same semantic cover for 0, 1, 2, 3 and 5 records without ordinal hierarchy', async () => {
    for (const total of [0, 1, 2, 3, 5]) {
      const subject = controller({ projects: Array.from({ length: total }, (_, i) => project({ id: i + 1, name: `Project ${i}` })) });
      const html = await (await subject.controller.get(hxList())).text();
      expect((html.match(/class="project-card"/g) ?? []).length).toBe(total);
      expect((html.match(/class="project-card-link"/g) ?? []).length).toBe(total);
      expect(html).not.toMatch(/col-span-|line-clamp-|min-h-\[|grayscale|opacity-40/);
      if (total === 0) expect(html).toContain('There are no published entries');
    }
  });

  test('escapes complete copy and tags and links only to the real detail route', async () => {
    const description = '<script>unsafe</script> '.repeat(40);
    const subject = controller({ projects: [project({ name: '<Tool "&">', description, tags: ['<svg onload="evil">'] })] });
    const html = await (await subject.controller.get(hxList())).text();
    expect(html).toContain('&lt;Tool &quot;&amp;&quot;&gt;');
    expect(html).toContain(description.trim().replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
    expect(html).toContain('&lt;svg onload=&quot;evil&quot;&gt;');
    expect(html).not.toContain('<script>unsafe');
    expect((html.match(/<a\s/g) ?? []).length).toBe(1);
    expect(html).toContain('href="/projects/1"');
    expect(html).toContain('aria-labelledby="project-title-1 project-action-1"');
    expect(html).not.toContain('github.com');
  });

  test('serves explicit responsive derivatives with a PNG fallback and reserved dimensions', async () => {
    const subject = controller({ projects: [project({ image: '/public/projects/pantheon-pixel.png' })] });
    const html = await (await subject.controller.get(hxList())).text();
    const sizes = 'sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 384px"';
    expect(html).toContain(`<source type="image/avif" ${sizes} data-srcset="/public/projects/pantheon-pixel-400.avif 400w, `);
    expect(html).toContain(`<source type="image/webp" ${sizes} data-srcset="/public/projects/pantheon-pixel-400.webp 400w, `);
    expect(html).toContain('/public/projects/pantheon-pixel-1200.avif 1200w, /public/projects/pantheon-pixel-1448.avif 1448w"');
    expect(html).toContain('<picture>');
    expect(html).toContain(' data-src="/public/projects/pantheon-pixel.png"');
    expect(html).not.toMatch(/\ssrc(?:set)?\s*=/);
    expect(html).toContain('width="1448" height="1086"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('alt=""');
    const other = controller({ projects: [project({ image: '/public/custom.png' })] });
    const custom = await (await other.controller.get(hxList())).text();
    expect(custom).toContain('<picture>');
    expect(custom).toContain(' data-src="/public/custom.png"');
    expect(custom).not.toMatch(/<source/);
    expect(custom).not.toMatch(/\ssrc(?:set)?\s*=/);
  });

  test('the detail page loads one responsive derivative eagerly', async () => {
    const subject = controller({ projects: [project({ image: '/public/projects/interpreter-pixel.png' })] });
    const html = await (await subject.controller.getPageById(new Request('http://localhost/projects/1'), 1)).text();
    expect(html).toContain('sizes="(max-width: 767px) 100vw, 768px" srcset="/public/projects/interpreter-pixel-400.avif 400w, ');
    expect(html).toContain(
      'type="image/webp" sizes="(max-width: 767px) 100vw, 768px" srcset="/public/projects/interpreter-pixel-400.webp 400w',
    );
    expect(html).toContain('src="/public/projects/interpreter-pixel.png"');
    expect(html).toContain('fetchpriority="high"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('width="1448" height="1086"');
    expect(html).not.toContain('loading="lazy"');
    expect(html).not.toContain('data-srcset');
    expect(html).toContain('/public/projects-motion.js');
    const owner = controller({ projects: [project({ image: '/public/projects/interpreter-pixel.png' })], canEdit: true });
    const ownerHtml = await (await owner.controller.getPageById(new Request('http://localhost/projects/1'), 1)).text();
    expect(ownerHtml).toContain('data-project-preview');
    expect(ownerHtml).toContain('/public/projects-motion.js');
    expect(ownerHtml).not.toMatch(/<source/);
  });

  test('missing or unsafe image URLs keep a useful fallback, never an empty or executable image', async () => {
    for (const image of [null, '', '  ', 'javascript:alert(1)', 'data:image/svg+xml,<svg onload="evil"/>']) {
      const subject = controller({ projects: [project({ image, icon: 'database' })] });
      const html = await (await subject.controller.get(hxList())).text();
      expect(html).toContain('project-cover-fallback');
      expect(html).toContain('database');
      expect(html).not.toContain('<img');
      expect(html).toContain('No short description provided.');
    }
  });

  test('escapes an image attribute without turning stored quotes into handlers', async () => {
    const subject = controller({ projects: [project({ image: '/public/image.png" onerror="alert(1)' })] });
    const html = await (await subject.controller.get(hxList())).text();
    expect(html).toContain('data-src="/public/image.png&quot; onerror=&quot;alert(1)"');
    expect(html).not.toContain(' onerror="');
  });

  test('localizes the action and empty state without translating stored project facts', async () => {
    const request = new Request('http://localhost/api/projects', { headers: { 'HX-Request': 'true', cookie: 'lang=ru' } });
    const subject = controller({ projects: [project({ name: 'Pantheon' })] });
    const html = await (await subject.controller.get(request)).text();
    expect(html).toContain('Открыть проект');
    expect(html).toContain('Pantheon');
    const empty = await (await controller().controller.get(request)).text();
    expect(empty).toContain('Пока нет опубликованных проектов');
  });

  test('detail content keeps supplied source links and owner-only controls', async () => {
    const item = project({ content: '<p><a href="https://github.com/begenchgeldyev/pantheon">Source</a></p>' });
    const req = new Request('http://localhost/projects/1');
    const visitor = await (await controller({ projects: [item] }).controller.getPageById(req, 1)).text();
    expect(visitor).toContain('href="https://github.com/begenchgeldyev/pantheon"');
    expect(visitor).not.toContain('id="project-upload-trigger"');
    const owner = await (await controller({ projects: [item], canEdit: true }).controller.getPageById(req, 1)).text();
    expect(owner).toContain('id="project-upload-trigger"');
  });

  test('cards use the tags field and the chosen icon', async () => {
    const { controller: subject } = controller({
      projects: [project({ id: 1, name: 'Tool', tags: ['Go'], icon: 'database' })],
    });
    const html = await (await subject.get(hxList())).text();
    expect(html).toContain('>Go<');
    expect(html).toContain('database');

    const automatic = controller({ projects: [project({ id: 2, name: 'Telegram Bot', icon: null, tags: [] })] });
    const botHtml = await (await automatic.controller.get(hxList())).text();
    expect(botHtml).toContain('smart_toy');
  });
});
