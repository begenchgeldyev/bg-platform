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
