import { describe, expect, test } from 'bun:test';
import type { ProjectsRepository } from '@bg/core';
import { AdminController } from './admin.controller';

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
  constructor(private projects: Project[] = []) {}

  async list({ includeHidden }: { includeHidden: boolean }): Promise<Project[]> {
    return includeHidden ? this.projects : this.projects.filter((item) => !item.isHidden);
  }
}

function createController(options: { projects?: Project[]; email?: string | null; canEdit?: boolean }) {
  const repository = new FakeProjectsRepository(options.projects ?? []);
  return new AdminController({
    projectsRepository: repository as unknown as ProjectsRepository,
    canEditProjects: async () => options.canEdit ?? false,
    sessionEmail: () => options.email ?? null,
  });
}

describe('AdminController', () => {
  test('shows the login form without a session', async () => {
    const controller = createController({
      projects: [project({ name: 'Secret Plan' })],
      email: null,
      canEdit: false,
    });
    const response = await controller.page(new Request('http://localhost/admin'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');

    const html = await response.text();
    expect(html).toContain('data-admin-login');
    expect(html).not.toContain('Secret Plan');
  });

  test('explains a session without edit rights', async () => {
    const controller = createController({
      projects: [project({ name: 'Secret Plan' })],
      email: 'viewer@example.com',
      canEdit: false,
    });
    const response = await controller.page(new Request('http://localhost/admin'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');

    const html = await response.text();
    expect(html).toContain("can't edit projects yet");
    expect(html).not.toContain('data-admin-login');
  });

  test('lists every project, hidden ones too, for the owner', async () => {
    const controller = createController({
      projects: [project({ id: 1, name: 'Visible Project', isHidden: false }), project({ id: 2, name: 'Hidden Secret', isHidden: true })],
      email: 'begenchgeldyev@gmail.com',
      canEdit: true,
    });
    const response = await controller.page(new Request('http://localhost/admin'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');

    const html = await response.text();
    expect(html).toContain('data-admin-app');
    expect(html).toContain('Visible Project');
    expect(html).toContain('Hidden Secret');
    expect(html).toContain('rocket_launch');
  });

  test('escapes project data embedded in the page', async () => {
    const controller = createController({
      projects: [project({ id: 1, name: '</script><img src=x onerror=alert(1)>' })],
      email: 'begenchgeldyev@gmail.com',
      canEdit: true,
    });
    const response = await controller.page(new Request('http://localhost/admin'));
    const html = await response.text();
    expect(html).not.toContain('</script><img');
  });
});
