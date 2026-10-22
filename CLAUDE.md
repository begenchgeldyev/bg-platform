# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun install` instead of `npm install`
- Bun automatically loads `.env` — don't use dotenv.
- Use `Bun.serve()` for HTTP — don't use Express.
- Use `Bun.file` for file I/O — don't use `node:fs` readFile/writeFile.
- Use `bun:sqlite` for SQLite (don't use `better-sqlite3`), `Bun.sql` for Postgres (don't use `pg`).

## Commands

Run from the repo root (Bun workspace):

```bash
bun run dev          # hot-reload dev server (delegates to apps/site)
bun run start        # production server
bun run lint         # biome check (no writes)
bun run format       # biome check --write (formats + organizes imports)
bun run db:generate  # generate SQL migrations from schema changes
bun run db:migrate   # apply migrations to postgres
bun run db:seed      # seed owner user, default policies and portfolio projects (safe to re-run)
```

Local Docker stack:
```bash
docker compose -f infra/compose.yml up -d  # caddy, site, postgres
```

**Local env files:** `apps/site/.env` (for `bun run dev`) and `packages/core/.env` (for `bun run db:*`) — both hold `DATABASE_URL` (and `ADMIN_SECRET` for site). `infra/site.env` (created from `infra/site.env.example`) is the one Compose loads for the containerized site.

## Architecture

This is a personal portfolio site with a terminal/hacker aesthetic (dark theme, green accents, scanline animation).

### Request flow

```
Client → Caddy (SSL termination) → Bun server (port 8613)
```

The single Bun server (`apps/site/server.ts`) handles everything:
1. **API routes** (`/api/version`, `/api/title`, `/api/projects`, `/api/ask`, `/api/lang`, `/api/auth/login`, `/api/auth/logout`) — defined directly in `Bun.serve({ routes })`, with the `/api` prefix applied by `withPrefix()`.
2. **Static assets** (`/public/*`) — served from `apps/site/public/` via `servePublicAsset()`.
3. **HTML pages** (everything else) — dispatched to `renderPage()` in `apps/site/site.ts`, except `/admin`, which `AdminController` renders.

Cross-site and non-JSON guards are shared in `apps/site/http/requests.ts`; per-IP rate limiting is in `apps/site/http/rate-limit.ts`.

### Owner login and `/admin`

`POST /api/auth/login` takes `{ secret }`, compares it to `ADMIN_SECRET`, and sets a signed `bg_session` cookie: HttpOnly, SameSite=Lax, 30 days, Secure in production. `ADMIN_SECRET` is both the password and the session signing key, so it must be long and random; changing it logs every session out. Login is rate-limited to 5 attempts per 15 minutes per IP; `POST /api/auth/logout` clears the cookie. Both require JSON. Session code is in `packages/core/auth/session.ts`; the endpoints are in `apps/site/auth/auth.controller.ts`.

`/admin` (`apps/site/admin/admin.controller.ts`, templates in `apps/site/components/admin/`) is English-only, sent with `no-store` and `noindex`, and shows a login form, an "account can't edit" note, or the editor.

### SSR (server-side rendering)

`apps/site/site.ts` is the templating engine. It owns:
- **`PAGE_CONFIGS`** — maps URL paths to page metadata (title, active nav, footer variant, etc.).
- **`renderLayout()`** — assembles the full HTML document: shared `<head>` (Tailwind CDN, HTMX, fonts, custom CSS), header, page fragment, footer.
- **`resolveIncludes()`** — replaces `<!--#include filename.html-->` comments in page HTML with component partials from `apps/site/components/`.
- **`servePublicAsset()`** — path-safe static file serving with MIME detection.

Page fragments live in `apps/site/pages/`. Component partials (header, footer HTML) live in `apps/site/components/` but are currently superseded by the TypeScript `renderHeader()`/`renderFooter()` functions in `site.ts`.

Frontend uses **HTMX** (no React/Vue). Styling uses **Tailwind CSS from CDN** with a Material Design 3 color palette extended in the inline `tailwind.config`. Fonts: **OpenTUI Mono** (self-hosted woff2 in `apps/site/public/fonts/`, declared via `@font-face` in `shared-head.html`) for everything, with **Noto Sans Mono** (Google Fonts) next in the stack because OpenTUI Mono has no Cyrillic glyphs — `shared-head.html` defines one `MONO_STACK` and maps all four Tailwind families (`headline`, `body`, `label`, `mono`) to it, so the whole site is monospace.

### Interaction conventions

Use `onMouseDown` instead of `onClick` for interactive controls so UI actions feel more immediate. Preserve keyboard and accessibility behavior when a control needs it.

### htmx

The site runs **htmx 4**, so write htmx 4 syntax: colon-separated events (`htmx:config:request`, with request headers at `event.detail.ctx.request.headers`) and explicit attribute inheritance (`hx-target:inherited="…"`). Global htmx config lives in the `<meta name="htmx-config">` in `shared-head.html`; its `noSwap` keeps 4xx/5xx response bodies out of the page, as htmx 2 did.

### AI assistant

The home-page terminal's `ask <question>` command chats with an OpenAI model through AI SDK 7 (`ai`, `@ai-sdk/openai`). `apps/site/ask/` is the server side: `AskController` (registered in `app-container.ts`, routed at `POST /api/ask`) grounds every answer in the CV text from `pages/cv.html`, refuses cross-site and non-JSON requests, validates the AI SDK UI messages, resends history as plain text, and rate-limits per client IP. `apps/site/client/` is the browser side (AI SDK `AbstractChat`); `server.ts` bundles it with `Bun.build` at startup and serves it from memory at `/assets/ask-chat.js`. Config: `OPENAI_API_KEY` (the feature is off without it), `OPENAI_MODEL` (default `gpt-5.4-mini`), optional `OPENAI_BASE_URL`.

### Dependency injection

`packages/core/DIContainer.ts` is a hand-rolled singleton DI container. Classes decorated with `@Injectable()` or registered via `container.registerFactory()` are resolved lazily and cached as singletons.

Wiring lives in `apps/site/app-container.ts`. When adding new services, register them there.

### ABAC authorization

The PEP (`pep.ts`) takes the user's email from the signed `bg_session` cookie set by the admin login — there is no user header or client-set cookie any more.

The enforcement pipeline:
- **PEP** (`pep.ts`) — `canAccess(req, { actions, resource })` resolves the session email, fetches subject attributes and policies, calls the PDP.
- **PDP** (`pdp.ts`) — pure function that evaluates policies against `{ subject, action, resource, resourceAttributes, context }`. Deny-overrides-allow; defaults to deny if no policy matches.
- **PIP** (`pip.ts`) — fetches `users` and `policies` rows from Postgres.

Project writes do not use `enforce()`. `ProjectController` authorizes inside itself through an injected `canEditProjects(req)`, wired in `apps/site/app-container.ts`; it returns false without a database query when there is no session, and otherwise calls `canAccess(req, { actions: 'update', resource: 'project' })`. `enforce()` still exists in core but no route uses it.

Policies and user roles are stored in the database (`packages/core/db/schema.ts`). Seed the initial owner account and allow-all policy with `bun run db:seed`.

### Database

Drizzle ORM with PostgreSQL. Schema: `projects`, `users` (with `role` enum: owner/editor/viewer), `policies` (with `effect` enum: allow/deny).

Portfolio projects live in the `projects` table and are listed on `/projects`; seed them from `packages/core/db/seed.ts`. Each project has an `icon` (null means Automatic, otherwise one of `PROJECT_ICONS` in `apps/site/project/project-icons.ts`) and `tags` (text[]), both edited on `/admin`, where input limits live in `apps/site/project/project-input.ts`. Hidden projects are owner-only: they are left out of the list and the JSON for visitors, and their page returns 404. The seed inserts each project whose name is not in the table yet, so renaming a seeded project in the admin editor makes the next seed run add it again; it also re-inserts the `owner-full-access` policy if it is missing. Nothing runs the seed or migrations on deploy; to seed production, run `docker compose -f infra/compose.yml exec -T site bun /usr/src/app/packages/core/db/seed.ts` on the VPS. Apply migrations by hand before deploying code that needs them: point `DATABASE_URL` through an SSH tunnel to the VPS's loopback Postgres (it listens only on `127.0.0.1:5432`) and run `bun run db:migrate` from the repo root.

### Infrastructure

`infra/compose.yml` runs three services:
- **caddy** — Caddy 2, terminates HTTPS via automatic Let's Encrypt, reverse-proxies to `site:8613`. Config lives in `infra/Caddyfile`.
- **site** — the `apps/site` Bun app, built via `apps/site/Dockerfile` with the repo root as build context so it can install the workspace.
- **postgres** — PostgreSQL 17. `DATABASE_URL` and `ADMIN_SECRET` are injected via `infra/site.env` (untracked; create from `infra/site.env.example`). `POSTGRES_PASSWORD` in `compose.yml` only seeds a brand-new data volume; production's real password exists only in the VPS's `infra/site.env`.

Only Caddy is reachable from outside (80/443). Postgres is published on the VPS's loopback only (`127.0.0.1:5432`), for maintenance through an SSH tunnel. The site and Postgres talk on the internal `begenchgeldyev-network` bridge.
