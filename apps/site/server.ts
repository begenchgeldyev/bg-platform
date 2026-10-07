import { canAccess, enforce, resolveEmail } from '@bg/core/abac/pep';
import type { Server } from 'bun';
import { container } from './app-container';
import { AskController } from './ask/ask.controller';
import { buildClientBundle, serveClientBundle } from './client-bundle';
import { resolveLang } from './i18n';
import { handleLangRequest } from './lang-route';
import { ProjectController } from './project/project.controller';
import { renderPage, servePublicAsset } from './site';

const PORT = Number(process.env.PORT) || 8613;
// A model can stay silent for longer than Bun's default 10 s idle timeout before its first token.
const ASK_IDLE_TIMEOUT_SECONDS = 60;
const askChatBundle = await buildClientBundle();

function withPrefix<T>(prefix: string, routes: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(routes).map(([path, handler]) => [`${prefix}${path}`, handler]));
}

function clientIp(req: Request, server: Server<undefined>): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  return forwarded || server.requestIP(req)?.address || 'unknown';
}

Bun.serve({
  port: PORT,
  routes: Object.assign(
    withPrefix('/api', {
      '/version': () => Response.json({ sha: process.env.GIT_SHA ?? 'unknown' }),
      '/title': () => {
        const title = ['Javascript Ninja', 'VIM enjoyer', 'Software Engineer', 'Fullstack Developer'];
        const randomTitleIndex = Math.floor(Math.random() * title.length);
        const randomTitle = title.at(randomTitleIndex);
        return Response.json({ title: randomTitle });
      },
      '/projects': {
        GET: (req) => container.resolve(ProjectController).get(req),
        POST: enforce((req) => container.resolve(ProjectController).post(req), { actions: 'create', resource: 'project' }),
      },
      '/auth/login': {
        POST: async (req) => {
          let body: { secret?: string; email?: string } = {};
          try {
            body = await req.json();
          } catch {
            /* ignore */
          }
          const secret = process.env.ADMIN_SECRET;
          if (!secret || body.secret !== secret) {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
          }
          const email = body.email ?? 'begenchgeldyev@gmail.com';
          const cookie = `dev-user-email=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
          return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie } });
        },
      },
      '/lang': {
        POST: (req: Request) => handleLangRequest(req),
      },
      '/ask': {
        POST: (req: Request, server: Server<undefined>) => {
          server.timeout(req, ASK_IDLE_TIMEOUT_SECONDS);
          return container.resolve(AskController).handle(req, clientIp(req, server));
        },
      },
      '/auth/logout': {
        POST: () => {
          const cookie = `dev-user-email=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
          return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie } });
        },
      },
    }),
    {
      '/assets/ask-chat.js': (req: Request) => serveClientBundle(req, askChatBundle),
    },
  ),

  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (pathname.startsWith('/public/')) {
      return servePublicAsset(pathname);
    }

    const projectApiMatch = pathname.match(/^\/api\/projects\/(\d+)$/);
    if (projectApiMatch && req.method === 'PATCH') {
      const allowed = await canAccess(req, {
        actions: 'update',
        resource: 'project',
        resourceAttributes: { projectId: Number(projectApiMatch[1]) },
      });

      if (!allowed) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }

      return container.resolve(ProjectController).patch(req, Number(projectApiMatch[1]));
    }

    const projectDetailMatch = pathname.match(/^\/projects\/(\d+)$/);
    if (projectDetailMatch) {
      return container.resolve(ProjectController).getPageById(req, Number(projectDetailMatch[1]));
    }

    const page = await renderPage(pathname, resolveLang(req), resolveEmail(req));
    if (page) {
      return page;
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`Server running at http://localhost:${PORT}`);
