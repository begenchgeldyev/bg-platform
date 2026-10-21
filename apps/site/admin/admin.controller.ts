import { Injectable, type ProjectsRepository } from '@bg/core';
import type { CanEditProjects } from '../project/project.controller';
import { PROJECT_ICONS } from '../project/project-icons';
import { PROJECT_LIMITS } from '../project/project-input';
import { renderComponentTemplate, renderDocument } from '../site';

export interface AdminControllerDeps {
  projectsRepository: ProjectsRepository;
  canEditProjects: CanEditProjects;
  sessionEmail: (req: Request) => string | null;
}

function renderUnauthorized(): string {
  return `<main class="max-w-xl mx-auto px-6 py-24 min-h-[60vh] flex flex-col justify-center">
  <div class="border border-outline-variant/50 bg-surface-container-lowest/80 p-8 md:p-10 text-center space-y-6">
    <div class="w-12 h-12 mx-auto bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
      <span class="material-symbols-outlined text-2xl" aria-hidden="true">lock</span>
    </div>
    <div class="space-y-2">
      <div class="font-mono text-xs uppercase tracking-[0.2em] text-outline">[ACCESS RESTRICTED]</div>
      <p class="font-mono text-sm text-on-surface leading-relaxed">
        You're logged in, but this account can't edit projects yet.
      </p>
    </div>
    <div id="admin-unauthorized-status" role="alert" class="hidden border border-error/50 bg-error-container/20 text-error font-mono text-xs p-3 leading-normal"></div>
    <div>
      <button
        id="admin-unauthorized-logout"
        type="button"
        class="border border-outline-variant/60 bg-surface hover:border-primary-container hover:text-primary-container px-6 py-2.5 font-mono text-xs uppercase tracking-[0.2em] text-on-surface transition-colors cursor-pointer">
        [LOG OUT]
      </button>
    </div>
  </div>
</main>
<script>
  (() => {
    const btn = document.getElementById('admin-unauthorized-logout');
    const statusEl = document.getElementById('admin-unauthorized-status');
    if (!btn) return;
    const doLogout = async () => {
      btn.disabled = true;
      if (statusEl) {
        statusEl.classList.add('hidden');
        statusEl.textContent = '';
      }
      try {
        const res = await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (res.ok) {
          window.location.reload();
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (statusEl) {
          statusEl.textContent = data.error || 'Failed to log out';
          statusEl.classList.remove('hidden');
        }
      } catch (_err) {
        if (statusEl) {
          statusEl.textContent = 'Network error while logging out';
          statusEl.classList.remove('hidden');
        }
      } finally {
        btn.disabled = false;
      }
    };
    btn.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        e.preventDefault();
        doLogout();
      }
    });
    // Native buttons fire a click (detail 0) for Enter, Space, screen readers and
    // synthetic activations; the pointer click reports a click count, so skip it.
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) {
        doLogout();
      }
    });
  })();
</script>`;
}

@Injectable()
export class AdminController {
  private readonly projectsRepository: ProjectsRepository;
  private readonly canEditProjects: CanEditProjects;
  private readonly sessionEmail: (req: Request) => string | null;

  constructor(deps: AdminControllerDeps) {
    this.projectsRepository = deps.projectsRepository;
    this.canEditProjects = deps.canEditProjects;
    this.sessionEmail = deps.sessionEmail;
  }

  async page(req: Request): Promise<Response> {
    const email = this.sessionEmail(req);

    const docConfig = {
      title: {
        en: 'ADMIN — BEGENCH_GELDYEV@ROOT:~$',
        ru: 'ADMIN — BEGENCH_GELDYEV@ROOT:~$',
      },
      fragmentFile: 'projects.html',
      brandIsLink: true,
      footerVariant: 'default' as const,
      showTerminalIcon: true,
    };

    const responseHeaders = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    };

    if (!email) {
      const content = await renderComponentTemplate('admin/login.html');
      return new Response(await renderDocument(docConfig, content, 'en'), {
        headers: responseHeaders,
      });
    }

    const canEdit = await this.canEditProjects(req);
    if (!canEdit) {
      const content = renderUnauthorized();
      return new Response(await renderDocument(docConfig, content, 'en'), {
        headers: responseHeaders,
      });
    }

    const projects = await this.projectsRepository.list({ includeHidden: true });
    const serializedProjects = JSON.stringify(projects).replaceAll('<', '\\u003c');
    const serializedIcons = JSON.stringify(PROJECT_ICONS).replaceAll('<', '\\u003c');
    const serializedLimits = JSON.stringify({
      maxNameChars: PROJECT_LIMITS.maxNameChars,
      maxDescriptionChars: PROJECT_LIMITS.maxDescriptionChars,
      maxImageBytes: PROJECT_LIMITS.maxImageBytes,
    }).replaceAll('<', '\\u003c');
    const maxImageMb = Math.round(PROJECT_LIMITS.maxImageBytes / (1024 * 1024));
    const script = await renderComponentTemplate('admin/script.html');
    const content = await renderComponentTemplate('admin/page.html', {
      projectsJson: serializedProjects,
      iconsJson: serializedIcons,
      limitsJson: serializedLimits,
      maxDescriptionChars: String(PROJECT_LIMITS.maxDescriptionChars),
      maxImageMb: String(maxImageMb),
      maxNameChars: String(PROJECT_LIMITS.maxNameChars),
      script,
    });

    return new Response(await renderDocument(docConfig, content, 'en'), {
      headers: responseHeaders,
    });
  }
}
