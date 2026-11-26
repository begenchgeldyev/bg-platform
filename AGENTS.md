# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## Documentation

- `GLOSSARY.md` — the canonical vocabulary. Use its terms in code, UI copy and new documents; the `_Avoid_` lines name the words they replace.
- `docs/architecture.md` — request flow, the SSR engine, `/admin`, the AI assistant, ABAC, the database and infrastructure. Read it before changing those areas.
- `docs/design/tokens.md` — colours, radii, type, layout and motion. Read it before changing anything visual.
- `docs/adr/` — accepted architecture decisions, each with the alternative it rejected. Read the relevant ADR before changing one.
- `apps/site/tests/README.md` — what the existing Playwright checks cover and how they are configured.
- Packages are deep modules: read [packages/README.md](./packages/README.md) before adding or importing one.

## Runtime

Bun, not Node.js.

- `bun <file>`, `bun install`, `Bun.serve()`, `Bun.file`, `Bun.sql` for Postgres, `bun:sqlite` for SQLite.
- Bun loads `.env` and then `.env.local`; do not add dotenv.

## Commands

Run from the repo root (Bun workspace):

```bash
bun run preview      # canonical preview on port 8613: database + dev server, prints the URL
bun run dev          # hot-reload dev server only (delegates to apps/site)
bun run start        # production server
bun run test         # every workspace test from the root; apps/site alone misses packages/
bun run test:browser # Playwright checks against SITE_URL (default http://localhost:8613)
bun run lint         # biome check (no writes)
bun run lint:boundaries # dependency-cruiser: package entry points, private tests/fixtures, no cycles
bun run format       # biome check --write (formats + organizes imports)
bun run db:local     # local Postgres on 127.0.0.1:5433, migrate, seed
bun run db:generate  # generate SQL migrations from schema changes
bun run db:migrate   # apply migrations to postgres
bun run db:seed      # seed owner user, default policies and portfolio projects (safe to re-run)
```

**Local environment.** `bun run db:local` starts `infra/compose.local.yml` and writes `DATABASE_URL` into the untracked `apps/site/.env.local` and `packages/core/.env.local`, which Bun loads after `.env`; then it migrates and seeds. Without a database the pages still render, but `/api/projects` is empty and the project grid never appears. `infra/site.env` (from `infra/site.env.example`) belongs to the containerized stack only.

**Preview.** A preview always owns port 8613, in whichever checkout runs it. `bun run preview` stops whatever holds 8613, starts this checkout there and prints the URL. When you hand work to the owner, give that exact URL and say that production is unchanged until the merge.

## Browser checks

Use the globally installed `agent-browser` when real browser verification or interaction can answer questions static tests cannot: HTMX navigation, forms, keyboard behavior, or language flows. Prefer a local dev instance. Browser checks supplement, not replace, the relevant Bun validation.

- Reuse the repository checks before inventing browser scripts: `bun run test:browser` runs `apps/site/tests/*.browser.ts` against `SITE_URL`, using the Playwright and Chromium already on the machine. Move anything that should survive the session into a `*.browser.ts` or a Bun test.
- Before using `agent-browser`, load the official skill or read `agent-browser skills get core`; follow its current CLI guidance rather than adding a repository guide or dependency.
- Choose a unique browser session for your task and pass `--session <your-session>` explicitly on every browser command. Use the snapshot → refs → interaction → fresh snapshot/DOM inspection loop; refresh refs after navigation or DOM changes. Close only your own session when finished: `agent-browser --session <your-session> close`.
- Inspect DOM state and behavior by default; take screenshots only to answer a specific visual question, not as a blanket requirement.
- Stay within the task's authorization: get explicit approval before production access, Admin writes, or AI requests through the Terminal. Do not change the app runtime or authorization policies to enable browser checks.

## Architecture

Request flow, the SSR engine, `/admin` and owner sessions, the AI assistant, dependency injection, ABAC, the database and infrastructure: [docs/architecture.md](./docs/architecture.md).

## Interaction conventions

Use `onMouseDown` instead of `onClick` for interactive controls so UI actions feel more immediate. Preserve keyboard and accessibility behavior when a control needs it.

## htmx

The site runs htmx 4, so write htmx 4 syntax: colon-separated events (`htmx:config:request`, with request headers at `event.detail.ctx.request.headers`) and explicit attribute inheritance (`hx-target:inherited="…"`). Global htmx config lives in the `<meta name="htmx-config">` in `shared-head.html`; its `noSwap` keeps 4xx/5xx response bodies out of the page, as htmx 2 did.
