# Shared Page Path Headings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved Projects-style heading to Logs, Resume and individual project pages.

**Architecture:** Extract the existing heading CSS into the shared head and reuse it in existing SSR fragments. Keep the project's name-only editable H1 separate from decorative siblings; no new framework or route changes.

**Tech Stack:** Bun, server-rendered HTML, HTMX, existing Tailwind styles and browser fixtures.

**Spec:** `docs/superpowers/specs/2026-11-15-path-headings-design.md`

## Global Constraints

- Literal `~/logs`, `~/resume`, `~/project/` plus the exact stored project name in both languages.
- Match Projects' 24px / 21px heading, green block cursor, divider, two-second stepped blink and reduced-motion fallback.
- Match `px-5 sm:px-8 py-12 md:py-16`; preserve body cards and unrelated behavior.
- Preserve one H1, name-only editing, escaped rendering, routes, bilingual PDF labels and compatibility aliases.
- No new dependencies, production access, AI requests or unapproved Admin writes.

## Review Focus

- A 120-character unbroken project name at 320px must wrap without horizontal overflow (browser check).
- Mixed-case Cyrillic project names must preserve exact display and editor payload (controller test and editor fixture).
- Hostile HTML names must remain escaped, with no decorative prefix included in stored name (controller test).
- Reduced-motion users must see a static cursor on the new headings (browser check).
- Russian Resume must keep its translated, working download action below the divider (SSR and browser check).

---

### Task 1: Shared heading implementation and focused tests

**Owner:** Designer owns all UI changes and the related focused regression tests; parent validates artifacts.

**Files:**
- Modify: `apps/site/components/shared-head.html` and `apps/site/components/projects/gallery.html` (move existing CSS without changing Projects appearance).
- Modify: `apps/site/pages/logs.html`, `logs.ru.html`, `resume.html`, `resume.ru.html` (path headings and matching main spacing).
- Modify: `apps/site/components/header.html` (Resume heading and separate PDF row).
- Modify: `apps/site/components/projects/page.html` (page-level editable name heading).
- Test: `apps/site/site.test.ts`, `apps/site/project/project.controller.test.ts`.
- Browser test: extend `apps/site/tests/projects-header.browser.ts` or add `apps/site/tests/path-headings.browser.ts` using existing fixture conventions.

**Interfaces:**
- Consumes: existing `.projects-header` appearance, SSR include values and `data-project-field="name"` editor contract.
- Produces: reusable shared path-heading styling; unchanged existing Projects selectors; new headings rendered without controller/API changes.

- [ ] Add failing EN/RU rendering tests asserting H1 text `logs` / `resume`, absence of old intro blocks, one H1, and localized download link outside/below the path header.
- [ ] Add project heading assertions: `~/project/` decoration before a single name-only H1 above Back link/grid; exact mixed-case/Cyrillic name and escaped hostile input. Keep existing stored-name and route/title checks.
- [ ] Run `bun test apps/site/site.test.ts apps/site/project/project.controller.test.ts`; record the expected new-assertion failures before implementation.
- [ ] Implement shared CSS and template changes per spec. Keep Resume intro markup in its partial; preserve download attributes. Keep project prefix/cursor outside the editable H1, remove its old uppercase styling and only obsolete description margin.
- [ ] Add browser coverage for EN/RU Logs and Resume, Projects baseline, a fixture project with ordinary and 120-character unbroken names, widths 320/390/1440px, cursor animation/reduced motion, full-width placement and name-only editing payload. Reuse existing local fixtures; do not contact a real Admin session. Browser CLI must follow repository `agent-browser skills get core` guidance with a unique explicit session if used interactively.
- [ ] Run focused tests again, including `bun test apps/site/i18n.test.ts apps/site/ask/resume-knowledge.test.ts`; report exact commands and exits. Do not run the full suite or commit application changes yet.

### Task 2: Reconcile, review and final evidence

**Owner:** Parent reads the diff; a focused reviewer checks spec and editor/SSR safety. A fixer owns final command execution once writers are reconciled.

**Files:** Review Task 1 artifacts only; do not introduce unrelated changes.

**Interfaces:** Consumes completed templates/styles/tests; produces command logs and browser report under `/tmp/opencode/path-headings`.

- [ ] Read the complete diff and verify no scope drift, untranslated new labels, duplicate H1 or editor decoration inside the name field. Review Projects CSS preservation and long-name cursor flow.
- [ ] Run `bun test apps/site/site.test.ts apps/site/project/project.controller.test.ts apps/site/i18n.test.ts apps/site/ask/resume-knowledge.test.ts`, `bun run lint`, `bun run lint:boundaries`, and `git diff --check` after the last edit. All should exit 0; investigate failure excerpts before repairs.
- [ ] Execute the focused browser script with local fixture setup using the existing Playwright/Chromium paths, recording exact environment/command and JSON report. If browser infrastructure is unavailable, report that limitation rather than claim visual acceptance.
- [ ] If repairs change tested artifacts, rerun only affected evidence. Report completed behavior and any remaining uncertainty; leave application changes uncommitted unless requested.
