# Project UI Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Implement the approved compact headings, contact copy interaction and optional project destination links, then leave a local preview running.

**Architecture:** Extend existing project columns and CRUD with nullable destinations, using one site URL validator for save and render. Designer owns templates/CSS/browser interaction presentation; fixer owns persistence/parsing/controller data contracts. Reconcile both before final verification.

**Tech Stack:** Bun, TypeScript, Drizzle/PostgreSQL, SSR HTML/Tailwind, HTMX 4, agent-browser.

**Spec:** `docs/superpowers/specs/2026-11-15-project-ui-refinements-design.md`

## Global Constraints

- Main workspace; no production writes/push/deploy for this task.
- GitHub accepts absolute HTTPS github.com repository URLs; Live app HTTP(S).
- Trim whitespace; reject credentials, control characters, malformed values and >2,048 characters.
- Create missing/null/blank becomes null; PATCH omission unchanged, blank/null clears.
- Stored names and editing values retain case; lowercase heading is presentation only.
- Replace metadata with links, preserve owner controls, hide empty visitor panel without vacant column.
- Use public package entry points and existing authorization. No dependency additions or URL fetches.
- User additionally requests the finished site running locally for inspection.

## Review Focus

- Clipboard denied/unavailable and repeated HTMX navigation: no false success/duplicate copy.
- Mixed-case Cyrillic/long names edited inline: display lowercase without modifying raw saved text.
- Both links absent: full-width content for visitor; owner controls still usable.
- URL parser normalizes controls/userinfo/lookalike hosts: reject unsafe input and unsafe stored hrefs.
- Admin's button save bypasses native submission: invalid destinations produce actionable feedback and no write.

## Task 1: Project destinations data contract (fixer)

**Files:** `packages/core/db/schema.ts`, `packages/core/project/project.repository.ts`, generated `packages/core/drizzle/migrations/*`; `apps/site/project/project-links.ts` (new pure validator), `project-input.ts`, `project.controller.ts`, relevant project tests; core seed/test typed fixtures as needed. Only controller-level new translation values are supplied as escaped literals or per-language helper without editing shared dictionaries owned by designer.

**Interfaces:** `Project` and `ProjectInput` gain `githubUrl: string | null`, `liveUrl: string | null`. Export `PROJECT_URL_MAX_CHARS = 2048` and `parseProjectUrl(value: unknown, field: 'githubUrl' | 'liveUrl'): {ok:true,value:string|null}|{ok:false,error:string}` from site `project-links.ts`; expose matching `PROJECT_LIMITS.maxUrlChars`.

**UI contract:** Controller supplies `projectLinksHtml` (trusted rendered optional anchor list only, no wrapper), `projectHasSidebar` class slot (`lg:grid-cols-12` or empty), `projectContentColumns` slot (`lg:col-span-8` or empty), and `projectSidebarHtml` (complete optional sidebar rendered using designer's `projects/links.html` template). Template consumes `linksHtml`, `adminControls`, `linksHeading` and optional panel sections. Backend and designer agree exact slots before writing overlaps. Existing page name remains raw escaped.

- [ ] Add parser tests: both links/defaults, PATCH omission/clear, trimming, 2,048 boundary, nonstrings, controls/credentials/scheme/host/path edge cases; observe RED.
- [ ] Implement nullable schema/input fields and pure URL validation, generate SQL+metadata with Bun; do not run migrations on unverified DATABASE_URL.
- [ ] Add detail rendering tests for both/one/neither links, safe attributes, escaping, unsafe DB suppression, hidden access and owner controls; observe RED then implement controller integration using designer template contract.
- [ ] Update owned typed fixtures/seed create input to null URLs, preserving existing body links. Coordinate non-owned fixture changes with designer.
- [ ] Run focused `bun test apps/site/project/project-input.test.ts apps/site/project/project.controller.test.ts` and core relevant tests. Capture commands/exits RED/GREEN and generated-migration inspection; no commit until parent reconciliation.

## Task 2: Approved UI and Admin destinations (designer)

**Files:** `apps/site/components/header.html`, `shared-head.html`, `footer-home.html`, `pages/index.html`, `pages/index.ru.html`; project `page.html`, new `links.html`; Admin `page.html`, `script.html`; `admin/admin.controller.ts` and test for limits only if necessary; `i18n.ts`, `site.ts`, `site.test.ts`; existing public scripts/new small clipboard script and corresponding focused tests; browser fixtures.

**Consumes:** nullable URL fields + `PROJECT_LIMITS.maxUrlChars` and controller/template slots from Task 1. Do not edit backend validator/schema/controller files owned by fixer. Preserve existing owner controls and editor-script's name-only editing contract.

- [ ] Update focused tests to assert approved heading/action row, removed home strip, email copy control/status, case-preserving lowercase display and metadata removal. Observe RED before implementation.
- [ ] Implement template/style changes, project links template and responsive no-sidebar grid. Use green inherited name color and scoped display lowercase; eliminate slash/name gap without affecting cursor layout or other headings.
- [ ] Implement email copy pointer/keyboard/touch lifecycle safely across HTMX, localized success/failure via accessible status; tests cover denial/unavailable/repeated navigation.
- [ ] Add Admin URL inputs, hydrate/reset/save and explicit validity feedback before button-triggered save. Use field limits from server, rename existing portfolio 'View live' action to unambiguous copy if necessary.
- [ ] Add/update focused browser fixtures typed URL nulls; run focused site/Admin/clipboard tests and CSS build. Capture exact commands/exits; no full suite or commits.

## Task 3: Reconciliation, verification and local preview (parent + validation specialist)

**Files:** update `GLOSSARY.md` Project definition; plan/progress evidence. Any mechanical missing typed fixture fields go to original scope owner.

- [ ] Inspect actual writer artifacts and reconcile slots before final validation; fix missing/out-of-scope work through same sessions.
- [ ] Validate migration against an isolated local PostgreSQL if available; otherwise report the precise gap, not a production test. Never expose DB ports publicly.
- [ ] Independent review of spec/standards, focused on five Review Focus cases. Delegate no repeated discovery.
- [ ] Run final `bun test` once, CSS build, changed-file Biome, boundary check with supported Node24, `git diff --check`; report baseline unrelated failures separately with excerpts.
- [ ] Load agent-browser CLI skill/current guidance; unique session explicit on every command. Use self-contained fixtures to check EN/RU desktop/mobile layouts, copy states, raw name saves, Admin URL behavior and optional links. Capture screenshots only to settle concrete layout questions.
- [ ] Start task-owned local dev site with no AI requests. Verify HTTP pages/version, use local DB only if its host is verified local. Leave running and report actual URL/logs. If real preview requires missing local configuration, explain exact blocker and offer self-contained fixture rather than pointing at production.
- [ ] Report changes and evidence; no push/deploy inferred from prior infra authorization.

## Plan self-review

Approved requirements are assigned to data/UI/integration owners, no overlapping
writer files permitted after initial contract agreement. Test boundaries use real
parsers/templates and browser clipboard external boundary, not fabricated success.
Preview is explicit delivery criterion; migrations and existing rows remain safe.
