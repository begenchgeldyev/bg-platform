# Resume Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Resume the canonical term and address without breaking existing CV links or changing the professional summary's content.

**Architecture:** Retain the existing Bun SSR renderer and language-cookie selection. Render `/resume`, redirect `/cv` before page-cache lookup, and alias the old PDF filename to the renamed asset in the existing static handler. Keep assistant grounding in the same bilingual-page content source, renamed consistently.

**Tech Stack:** Bun, TypeScript, HTML partials, bun:test, existing Biome/dependency-cruiser checks.

**Spec:** User-approved conversation: Resume navigation, Download resume action, `/resume` with `/cv` redirect, `Begench-Geldyev-Resume.pdf` with old URL preserved; owner summary available as page and PDF. Footer layout remains separate.

## Global Constraints

- Work only in the supplied feature/footer worktree; no commits, new worktrees, or pushes without instruction.
- Existing architecture, content, authentication, assistant limits and page styles remain unchanged.
- English uses Resume / Download resume; Russian uses Резюме / Скачать резюме.
- Use existing `GLOSSARY.md`, not a competing CONTEXT.md; retain historical plans/specs and ADR filenames/source history.
- Preserve previous untracked footer prototype and companion artifacts; do not promote a footer design.
- Canonical page `/resume`; old `/cv` returns permanent 308 with bodyless response and preserved search string.
- Canonical PDF `/public/Begench-Geldyev-Resume.pdf`; old encoded filename remains an alias with identical serving semantics.

## Review Focus

- Legacy `/cv?source=mail` redirects to fixed `/resume?source=mail`, even with conditional headers; never a stale 304.
- Both languages show an actual heading and translated download action, not a silently missing include.
- Canonical and legacy PDF support equal bytes, MIME, HEAD, ranges, validators and invalid-path protections.
- Resume page keeps language-specific production ETags and bodyless HEAD; dev HEAD is also bodyless.
- Assistant loader and terminal completion resolve the renamed content; `open cv` stays a compatibility alias.

---

### Task 1: Canonical page, downloads and public references

**Files:** `apps/site/site.ts`, `i18n.ts`, `pages/cv{,.ru}.html` → `resume{,.ru}.html`, `components/header.html`, `footer-home.html`, `footer-default.html`, `page-transitions.html`, `terminal-emulator.html`, `public/Begench Geldyev(CV).pdf` → `Begench-Geldyev-Resume.pdf`; matching `site.test.ts`, `i18n.test.ts`, `favicon-blink.test.ts`, `terminal-completion.test.ts`, browser navigation fixtures under `apps/site/tests/`.

**Interfaces:** Preserve `renderPage(pathname, lang, req?)` and `servePublicAsset(pathname, req?)`; update their existing behavior, not the server architecture. Header include receives bilingual labels through the existing template mechanism or translated page fragments. New active navigation key `resume` and `navResume`/`footerResumeLink` replace CV names.

- [ ] Write real renderer tests before production edits. Assert `/resume` 200 with `href="/resume"`, English Resume and Download resume; Russian Резюме and Скачать резюме; an actual H1 and no missing header include.
- [ ] Test `/cv` GET/HEAD returns 308, `Location: /resume` plus original query, empty body even with `If-None-Match`. Test canonical HEAD bodyless in dev/production and existing language ETag behavior.
- [ ] Test new PDF full bytes, PDF MIME, HEAD, partial range, 416 and 304; compare old decoded/encoded filename alias to canonical bytes and protocol behavior. Preserve traversal/malformed-encoding tests.
- [ ] Run `bun test apps/site/site.test.ts apps/site/i18n.test.ts` and record expected missing-feature failures before implementation.
- [ ] Implement canonical configuration, rename fragments/asset, narrow legacy redirect and PDF alias. Repair `components/header.html` include resolution, translate download copy, and update current UI/terminal/speculation references. Preserve `open cv` alias while advertising `open resume`; adjust terminal tests and browser route selectors.
- [ ] Run renderer/i18n/favicon/terminal suites and record green output. Keep typography/layout unchanged.

### Task 2: Grounding vocabulary and integration

**Files:** `apps/site/ask/cv-knowledge{,.test}.ts` → `resume-knowledge{,.test}.ts`, `ask/instructions.ts`, `ask/ask.controller{,.test}.ts`, `ask/virtual-tools{,.test}.ts`, `client/ask-chat.test.ts`, `app-container.ts`, `GLOSSARY.md`, `AGENTS.md`, `docs/adr/0009-ai-grounded-in-cv-text.md`.

**Interfaces:** `loadResumeText()` replaces `loadCvText()` and reads `pages/resume.html`; rename injected `cvText` to `resumeText` atomically across callers/tests. No changes to caps, caching, security or knowledge contents.

- [ ] Add a regression assertion that grounding reads the canonical resume fragment and still includes existing professional facts; assert instructions describe Resume rather than CV. Run it and record expected failures before implementation.
- [ ] Rename grounding module/functions/dependencies and update current instructions and test fixtures. Update glossary with canonical Resume definition and Grounding source; update current developer/ADR terminology without rewriting history or creating a new ADR.
- [ ] Run `bun test` from repository root, `bun run lint`, and `bun run lint:boundaries`. Report setup limitations or unrelated failures by name; do not mask them. Inspect all changed files and any untracked additions.
- [ ] Start the normal app on a free port and smoke canonical/legacy GET+HEAD and both PDF URLs; run a focused browser navigation/download check if available. Coordinator independently verifies evidence and records acceptance/open checks.
- [ ] Stop only temporary validation processes. Leave commits/push and footer prototype capture for explicit later instruction.
