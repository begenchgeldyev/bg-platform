import { describe, expect, test } from 'bun:test';
import type { Project } from '@bg/core';
import { PROJECT_LIMITS } from '../project/project-input';
import { AdminController } from './admin.controller';

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
    projectsRepository: repository,
    projectAccess: async () => (!options.email ? 'visitor' : options.canEdit ? 'editor' : 'read-only'),
  });
}

function scriptSection(html: string, start: string, end: string): string {
  const from = html.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = html.indexOf(end, from);
  expect(to).toBeGreaterThan(from);
  return html.slice(from, to);
}

describe('AdminController', () => {
  test.each(['visitor', 'read-only', 'editor'] as const)('applies the admin document policy and HEAD behavior to %s', async (access) => {
    const controller = new AdminController({
      projectsRepository: new FakeProjectsRepository([project()]),
      projectAccess: async () => access,
    });
    const response = await controller.page(new Request('http://localhost/admin', { headers: { cookie: 'lang=ru' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.get('etag')).toBeNull();
    const html = await response.text();
    expect(html).toContain('<html class="dark" lang="en">');
    expect(html).toContain('>Projects<');
    expect(html).toContain('<title>ADMIN — BEGENCH_GELDYEV@ROOT:~$</title>');
    expect(html).not.toContain('type="speculationrules"');
    expect(html).not.toContain('@view-transition');
    expect(html).toContain(
      access === 'visitor' ? 'data-admin-login' : access === 'read-only' ? "can't edit projects yet" : 'data-admin-app',
    );
    const head = await controller.page(
      new Request('http://localhost/admin', {
        method: 'HEAD',
        headers: { cookie: 'lang=ru', 'if-none-match': '*' },
      }),
    );
    expect(head.status).toBe(200);
    expect(head.headers.get('cache-control')).toBe('no-store');
    expect(head.headers.get('x-robots-tag')).toBe('noindex');
    expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength(html)));
    expect(await head.text()).toBe('');
  });

  test('uses one project-access decision, without reading projects for visitor or read-only sessions', async () => {
    for (const access of ['visitor', 'read-only', 'editor'] as const) {
      const calls: string[] = [];
      const controller = new AdminController({
        projectsRepository: {
          async list() {
            calls.push('list');
            return [];
          },
        },
        async projectAccess() {
          calls.push('access');
          return access;
        },
      });
      await controller.page(new Request('http://localhost/admin'));
      expect(calls).toEqual(access === 'editor' ? ['access', 'list'] : ['access']);
    }
  });

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

  test('the login button also answers keyboard and assistive clicks', async () => {
    const controller = createController({ email: null, canEdit: false });
    const html = await (await controller.page(new Request('http://localhost/admin'))).text();
    const loginScript = scriptSection(html, 'const form = document.querySelector', '})();');

    expect(loginScript).toContain("addEventListener('mousedown'");
    expect(loginScript).toContain("addEventListener('click'");
    expect(loginScript).not.toContain("addEventListener('keydown'");
  });

  test('the logout button on the restricted page answers keyboard and assistive clicks', async () => {
    const controller = createController({ email: 'viewer@example.com', canEdit: false });
    const html = await (await controller.page(new Request('http://localhost/admin'))).text();
    const logoutScript = scriptSection(html, 'const btn = document.getElementById', '})();');

    expect(logoutScript).toContain("addEventListener('mousedown'");
    expect(logoutScript).toContain("addEventListener('click'");
    expect(logoutScript).not.toContain("addEventListener('keydown'");
  });

  test('renders in English even when the request has a Russian lang cookie', async () => {
    const controller = createController({
      projects: [project({ name: 'Demo' })],
      email: 'begenchgeldyev@gmail.com',
      canEdit: true,
    });
    const request = new Request('http://localhost/admin', {
      headers: { Cookie: 'lang=ru' },
    });
    const response = await controller.page(request);
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain('<html class="dark" lang="en">');
    expect(html).not.toContain('<html class="dark" lang="ru">');
    expect(html).toContain('>Projects<');
    expect(html).not.toContain('>ПРОЕКТЫ<');
  });

  test('the editor takes its input limits from PROJECT_LIMITS', async () => {
    const controller = createController({
      projects: [project({ name: 'Demo' })],
      email: 'begenchgeldyev@gmail.com',
      canEdit: true,
    });
    const html = await (await controller.page(new Request('http://localhost/admin'))).text();

    const limitsJson = /<script id="admin-limits-data" type="text\/plain">(.*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(limitsJson).not.toBe('');
    expect(JSON.parse(limitsJson)).toEqual({
      maxNameChars: PROJECT_LIMITS.maxNameChars,
      maxDescriptionChars: PROJECT_LIMITS.maxDescriptionChars,
      maxImageBytes: PROJECT_LIMITS.maxImageBytes,
    });

    const maxImageMb = Math.round(PROJECT_LIMITS.maxImageBytes / (1024 * 1024));
    expect(html).toContain(`id="admin-form-name"`);
    expect(html).toContain(`maxlength="${PROJECT_LIMITS.maxNameChars}"`);
    expect(html).toContain(`maxlength="${PROJECT_LIMITS.maxDescriptionChars}"`);
    expect(html).toContain(`Max ${PROJECT_LIMITS.maxDescriptionChars} chars`);
    expect(html).toContain(`Max ${maxImageMb} MB (PNG, JPG, WEBP, GIF)`);
    expect(html).toContain(`Upload a project cover image (max ${maxImageMb} MB).`);
  });
});
