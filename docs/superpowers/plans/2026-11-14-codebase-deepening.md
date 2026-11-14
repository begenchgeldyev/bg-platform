# Codebase Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the four approved deep-module improvements while preserving the site's observable behavior and fixing the identified editing failure paths.

**Architecture:** Keep Bun, SSR templates, HTMX, and explicit composition. Move protocols behind small concrete interfaces rather than adding forwarding layers. Treat the four areas as independently testable tasks, scheduling shared-file changes sequentially.

**Tech Stack:** Bun, TypeScript, AI SDK 7, HTML/browser JavaScript, Drizzle/PostgreSQL, Biome, existing Playwright scripts.

**Spec:** `.slim/deepwork/codebase-deepening/note.md`, recording the four chat proposals approved by “fix it all”.

## Execution outcome

- [x] Task 0: existing dependencies restored with frozen lockfile; baseline failures recorded.
- [x] Task 1: shared project editing implemented and reconciled; 15 browser scenarios pass.
- [x] Task 2: single-result terminal implemented; missed integration consumers migrated; chat/focus browser checks pass.
- [x] Task 3: project access decision and structural repository contracts implemented; session/PDP and guard regressions pass.
- [x] Task 4: dynamic rendering policy implemented; production-rendered motion fixtures pass 11 checks.
- [x] Task 5: artifact reconciliation, full tests (276/276), changed-file lint (26 files), diff check and evidence records closed.
- [ ] Repository-wide lint: retains pre-existing failures in untouched files; no unrelated formatting or visual changes applied.

Changes are deliberately uncommitted. Detailed execution evidence and limitations: `.slim/deepwork/codebase-deepening/verification.md`. The task checklists below retain the approved implementation recipe; the outcome tracker above records execution.

## Global Constraints

- Preserve GLOSSARY.md terminology and accepted ADRs, especially 0001–0009.
- Preserve Bun/HTMX and existing visuals; no frontend framework, schema changes, or dependency upgrades.
- Preserve project write guard order: cross-site refusal → authorization → JSON-only refusal → bounded read.
- Preserve anonymous project access with zero policy reads, generic ABAC viewer semantics, default deny, deny overrides, and retained enforce().
- Preserve data-URL images and current PROJECT_LIMITS; derive browser limits from the server rather than duplicating values.
- Preserve terminal history rules, safe errors, final-answer-only display, language, keyboard behavior, focus, and scrolling.
- Keep static page revalidation distinct from dynamic session-sensitive documents; admin stays English, no-store, noindex, and transition-free.
- Run only local fixtures and model mocks; no production database or external model calls.
- Work in the supplied checkout. No commits, push, or deploy without a separate instruction.

## Review Focus

- Rejected fetch or malformed mutation response must release reservations and permit retry; Task 1 pins this.
- Rapid image/hide/save requests must not overwrite unrelated fields or leave optimistic state behind; Task 1 pins this.
- Empty/malformed/rejected assistant streams must settle once and remove failed history; Task 2 pins this.
- A valid but denied session, or policy-source failure, must never become editor access; Task 3 pins this.
- Hostile project titles remain inert, intended body HTML still renders, and owner-specific documents are not publicly cached; Task 4 pins this.

---

## File ownership and execution

- Task 1: new `apps/site/public/project-edits.js`, its Bun tests, both editor scripts and their embedding/limit data. No CSS/layout changes. Controller embedding changes must be sequenced with Tasks 3–4.
- Task 2: `apps/site/client/ask-chat.ts`, its tests, `components/terminal-emulator.html`, terminal completion and chat browser tests. Independent of the other tasks.
- Task 3: `packages/core/abac/*`, core exports/project types, composition root, admin/project dependency contracts and associated tests. Do not edit rendering logic owned by Task 4.
- Task 4: `apps/site/site.ts`, dynamic rendering call sites in admin/project controllers, document tests and `tests/projects-motion.browser.ts`. Starts after Tasks 1 and 3 release shared controllers.
- Coordinator: job records, final verification, user-facing copy inspection, and integration. Delegate genuinely visual decisions to designer, not fixer.

### Task 0: Restore the existing verification environment

- [ ] Run `bun install --frozen-lockfile`; do not update manifests or lockfile to solve setup problems.
- [ ] Run `bun test` and `bun run lint`; save exit codes and baseline failures in a sibling evidence report under the job directory.
- [ ] Locate existing Playwright module and Chromium; inspect browser harness startup needs. Do not add a test dependency without asking.
- [ ] Record any baseline failures separately from regressions. Escalate unavailable browser tooling as an open check rather than claiming success.

### Task 1: Shared browser project mutation lifecycle

**Files:** Create `apps/site/public/project-edits.js` and `apps/site/project/project-edits.test.ts`; modify `components/admin/script.html`, `components/projects/editor-script.html`, and their embedding templates/controllers as needed; add `apps/site/tests/project-edits.browser.ts`.

**Interfaces:** Produce `createProjectEdits({ project, limits })` with `save(changes)`, `remove()`, and `readImage(file)`. Save returns a discriminated success containing the server-returned project or a failure containing a bounded reason and safe message; remove/readImage use the same result convention with their respective value. Repeated operations while reserved return a busy result. The module uses browser fetch/FileReader; tests can substitute platform globals without adding a public transport hierarchy.

- [ ] Write failing interface tests: fetch rejection, malformed success JSON, HTTP refusal, retry, overlapping mutation, partial PATCH payload, and server-normalized project result. Pin image rejection before FileReader invocation using the supplied limit.
- [ ] Run `bun test apps/site/project/project-edits.test.ts` and record the expected pre-implementation failures.
- [ ] Implement operation reservation with guaranteed release and canonical persisted state updated only on success. Do not couple a session to mutable admin selection.
- [ ] Integrate both screens. Preserve admin draft-image behavior and inline immediate-image persistence. Use partial updates for hide/image operations, and restore optimistic state on every failure category.
- [ ] Add browser checks for both surfaces: failure then retry, no duplicate pointer/keyboard operation, oversized image, overlapping hide/image/save, and preservation of unrelated fields. Use rendered controller fixtures and intercepted local requests.
- [ ] Replace only source-string tests made redundant by exercised behavior; retain distinct authorization/HTTP tests.
- [ ] Run the new interface and browser checks plus existing admin/project tests. Record commands/results and changed paths; no commit.

### Task 2: Single-result terminal turn interface

**Files:** Modify `client/ask-chat.ts`, `client/ask-chat.test.ts`, `components/terminal-emulator.html`, `terminal-completion.test.ts`, and `tests/terminal-chat.browser.ts`.

**Interfaces:** `AskChat.ask(question: string): Promise<AskResult>`; `AskResult` is `{ ok: true; text: string } | { ok: false; reason: 'unavailable' | 'rate-limit' | 'question-length' | 'busy' }`. Keep `busy()` only if the real consumer needs its pre-submit guard; do not expose stream callbacks. A busy result does not alter active-turn history.

- [ ] Adapt/add tests for completed answers, follow-up history, safe reason classification, empty completion, rejected/malformed stream, failed-history rollback, and concurrent calls.
- [ ] Run `bun test apps/site/client/ask-chat.test.ts apps/site/terminal-completion.test.ts`; capture failures proving the old interface does not satisfy the contract.
- [ ] Implement result settlement and rollback inside createAskChat using the existing SDK. Clear per-turn state on every exit; never leak provider details.
- [ ] Simplify the terminal caller to consume one result. Preserve synchronous submission locking and all focus, scroll, retry-draft, accessibility, and localization behavior.
- [ ] Update browser test doubles to the real result contract while retaining SSE tests against the actual client.
- [ ] Run the targeted Bun tests and `SITE_URL=<local-fixture-url> PLAYWRIGHT_MODULE=<existing-module> bun apps/site/tests/terminal-chat.browser.ts`; record results and no commit.

### Task 3: One project-access decision

**Files:** Modify `packages/core/abac/pep.ts`, `pip.ts`, their tests, `packages/core/index.ts`, `packages/core/project/project.repository.ts`, `apps/site/app-container.ts`, admin/project dependency contracts and their tests; create a focused core project-access module if needed for locality.

**Interfaces:** Produce `ProjectAccess = 'visitor' | 'read-only' | 'editor'` and a configured `projectAccess(req: Request): Promise<ProjectAccess>`. Configuration binds session identity resolution and a narrow policy source with real Drizzle and controlled test adapters. Export the existing inferred `Project` type; consumers use narrow structural repository contracts instead of fake-to-concrete-class casts.

- [ ] Write failing tests using real signed sessions and the pure PDP: absent/invalid/expired/rotated sessions return visitor with zero policy reads; valid denied session returns read-only; allow returns editor; matching deny wins; storage failure never grants access.
- [ ] Pin existing generic canAccess/enforce viewer behavior and controller write-guard order before changing orchestration.
- [ ] Run the authorization tests and capture pre-implementation failures.
- [ ] Implement project access, resolving identity once. Share the generic evaluation pipeline without globally early-denying anonymous ABAC callers. Reuse the configured database for the production PIP; retain enforce().
- [ ] Wire admin and project callers to the single decision. Preserve admin's three states and all hidden-project behavior. Do not cache decisions across requests.
- [ ] Remove unsafe repository fake casts through narrow structural types; fix any fake that does not persist its own updates.
- [ ] Run `bun test packages/core apps/site/admin/admin.controller.test.ts apps/site/project/project.controller.test.ts apps/site/auth/auth.controller.test.ts`. If SQL mapping changes, exercise a disposable local PostgreSQL contract check, never production; record unavailable database coverage explicitly.

### Task 4: Policy-owning dynamic document rendering

**Files:** Modify `apps/site/site.ts`, `site.test.ts`, admin/project rendering call sites and tests, and `tests/projects-motion.browser.ts`.

**Interfaces:** Produce `renderDynamicPage(req, { page: 'project' | 'admin', title: string, contentHtml: string }): Promise<Response>`. It accepts raw title text and trusted rendered content HTML. Keep the existing static renderPage interface unless a concrete caller demands otherwise. Remove the forwarding-only renderDocument export after migrating all callers.

- [ ] Add failing response-level tests for all admin states, English/no-store/noindex/no-transitions, inert hostile titles, intentional body HTML, dynamic HEAD behavior, visitor/owner hidden-project outcomes, and static language-specific ETags.
- [ ] Run the targeted site/admin/project tests and capture expected failures for the new interface.
- [ ] Implement concrete existing page presets, title escaping exactly once, response construction, and no-store for session-sensitive dynamic documents. Preserve static revalidation unchanged.
- [ ] Migrate dynamic controllers; remove irrelevant fragment configuration and duplicate title/header policy from callers. Find and migrate every renderDocument reference.
- [ ] Change image-motion fixtures to use actual controller rendering with deterministic project data rather than duplicated card/detail markup.
- [ ] Run `bun test apps/site/site.test.ts apps/site/admin/admin.controller.test.ts apps/site/project/project.controller.test.ts` and the existing projects-motion browser script against a local fixture server; record results and no commit.

### Task 5: Reconcile and close evidence

- [ ] Inspect every writer diff against the approved scope; confirm no shared-file work was overwritten and no visuals or copy changed unintentionally.
- [ ] Run `bun test`, `bun run lint`, and `git diff --check`; fix regressions without repo-wide formatting churn.
- [ ] Run/reuse final browser evidence for both project-edit surfaces, terminal chat, and production-rendered image motion. Rerun evidence only when relevant code or environment changed.
- [ ] Update AGENTS.md architecture descriptions if exported interfaces/wiring changed; preserve accepted ADR history and document any explicit consequence.
- [ ] Update state.md with reproducible commands, exit statuses, base SHA, inspected artifacts, and all remaining open checks. Normal workflow: no reviewer unless requested; escalate unresolved architecture/security trade-offs to oracle.
- [ ] Report the implemented changes and checks honestly; leave changes uncommitted for the user.
