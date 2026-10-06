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
bun run db:seed      # seed owner user and default policies
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
1. **API routes** (`/title`, `/projects`) — defined directly in `Bun.serve({ routes })`.
2. **Static assets** (`/public/*`) — served from `apps/site/public/` via `servePublicAsset()`.
3. **HTML pages** (everything else) — dispatched to `renderPage()` in `apps/site/site.ts`.

### SSR (server-side rendering)

`apps/site/site.ts` is the templating engine. It owns:
- **`PAGE_CONFIGS`** — maps URL paths to page metadata (title, active nav, footer variant, etc.).
- **`renderLayout()`** — assembles the full HTML document: shared `<head>` (Tailwind CDN, HTMX, fonts, custom CSS), header, page fragment, footer.
- **`resolveIncludes()`** — replaces `<!--#include filename.html-->` comments in page HTML with component partials from `apps/site/components/`.
- **`servePublicAsset()`** — path-safe static file serving with MIME detection.

Page fragments live in `apps/site/pages/`. Component partials (header, footer HTML) live in `apps/site/components/` but are currently superseded by the TypeScript `renderHeader()`/`renderFooter()` functions in `site.ts`.

Frontend uses **HTMX** (no React/Vue). Styling uses **Tailwind CSS from CDN** with a Material Design 3 color palette extended in the inline `tailwind.config`. Fonts: **Noto Sans Mono** for everything — `shared-head.html` defines one `MONO_STACK` and maps all four Tailwind families (`headline`, `body`, `label`, `mono`) to it, so the whole site is monospace.

### Interaction conventions

Use `onMouseDown` instead of `onClick` for interactive controls so UI actions feel more immediate. Preserve keyboard and accessibility behavior when a control needs it.

### htmx

The site runs **htmx 4**, so write htmx 4 syntax: colon-separated events (`htmx:config:request`, with request headers at `event.detail.ctx.request.headers`) and explicit attribute inheritance (`hx-target:inherited="…"`). Global htmx config lives in the `<meta name="htmx-config">` in `shared-head.html`; its `noSwap` keeps 4xx/5xx response bodies out of the page, as htmx 2 did.

### Dependency injection

`packages/core/DIContainer.ts` is a hand-rolled singleton DI container. Classes decorated with `@Injectable()` or registered via `container.registerFactory()` are resolved lazily and cached as singletons.

Wiring lives in `apps/site/app-container.ts`. When adding new services, register them there.

### ABAC authorization

Routes that require authorization wrap their handler with `enforce()` from `packages/core/abac/pep.ts`:

```ts
POST: enforce(handler, { actions: 'create', resource: 'project' })
```

The enforcement pipeline:
- **PEP** (`pep.ts`) — extracts `x-user-email` from the request header, fetches subject attributes and policies, calls the PDP.
- **PDP** (`pdp.ts`) — pure function that evaluates policies against `{ subject, action, resource, resourceAttributes, context }`. Deny-overrides-allow; defaults to deny if no policy matches.
- **PIP** (`pip.ts`) — fetches `users` and `policies` rows from Postgres.

Policies and user roles are stored in the database (`packages/core/db/schema.ts`). Seed the initial owner account and allow-all policy with `bun run db:seed`.

### Database

Drizzle ORM with PostgreSQL. Schema: `projects`, `users` (with `role` enum: owner/editor/viewer), `policies` (with `effect` enum: allow/deny).

### Infrastructure

`infra/compose.yml` runs three services:
- **caddy** — Caddy 2, terminates HTTPS via automatic Let's Encrypt, reverse-proxies to `site:8613`. Config lives in `infra/Caddyfile`.
- **site** — the `apps/site` Bun app, built via `apps/site/Dockerfile` with the repo root as build context so it can install the workspace.
- **postgres** — PostgreSQL 17. `DATABASE_URL` and `ADMIN_SECRET` are injected via `infra/site.env` (untracked; create from `infra/site.env.example`).

Only Caddy exposes host ports (80/443). The site and Postgres talk on the internal `begenchgeldyev-network` bridge.
