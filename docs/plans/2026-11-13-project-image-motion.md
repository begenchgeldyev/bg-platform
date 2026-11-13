# Project Image Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give existing project images subtle browser-authored motion without generating videos or calling an AI service.

**Architecture:** A small dependency-free browser enhancement shared by the project gallery and individual project pages. It preserves the responsive image/lazy-loading pipeline and untouched static artwork; the designer owns the visual treatment. Use one reusable behavior for future project images, not a per-project clip manifest.

**Tech Stack:** Bun, TypeScript SSR templates, HTMX 4, existing HTML/CSS, plain browser JavaScript, Bun tests and the repository's Playwright browser harness.

**Spec:** Owner's conversation approval (“ok, do it then”) after selecting authored CSS/JavaScript motion instead of video; existing interaction decisions in [Settle how project covers should move](https://github.com/begenchgeldyev/bg-platform/issues/17), superseded where they require generated video.

## Global Constraints

- No xAI, new provider/account/key, generated clips, AI calls at runtime, new dependencies, or credential changes.
- Work only in the existing `feature/animate-project-images` worktree; fixed point `db340b0ae16040a082c40e6caa5dd07b74a2c2df`.
- Preserve the pixel-art image, responsive AVIF/WebP sources, lazy decode/fallback behavior, layout and links.
- Cards animate on hover or keyboard focus; project-page images may animate while visible. Both stop when offscreen or the document is hidden. Touch-only cards remain static without hover emulation or blocking navigation.
- Reduced-motion and no-JavaScript users see the existing static image. A failed image must not leave floating decorative motion.
- No per-project coordinates/assets or mandatory image metadata. Later project images use the shared enhancement automatically; any accent must remain tasteful without scene-specific assumptions.
- Canonical product term is “image” (`GLOSSARY.md`). All visual choices belong to the designer.

## Review Focus

- HTMX replaces the gallery repeatedly: no duplicate enhancement, event handlers, or retained detached image nodes.
- Lazy/failed/transparent image: no animation before decode, no forced downloads, no obscured static fallback.
- Runtime preference change, offscreen scroll and hidden tab: decorative motion stops without hiding content.
- Touch/coarse-pointer and keyboard users: cards remain navigable, focus-visible behavior is intentional, no hover trap.
- Detail-page geometry and responsive sources: the enhancement must not move the image container, crop it differently or change image payload selection.

## Task 1: Shared, accessible image motion

**Files / responsibilities:**
- Create `apps/site/public/projects-motion.js`: dependency-free enhancement lifecycle for both surfaces, including preferences, visibility and HTMX reinitialization/cleanup.
- Create `apps/site/components/projects/image-motion.html`: shared designer-owned motion styles and deferred script inclusion (or a smaller equivalent fitting existing templates).
- Modify `apps/site/components/projects/gallery.html` and `apps/site/components/projects/page.html`: include shared enhancement without placing it inside swapped gallery content.
- Add `apps/site/tests/projects-motion.browser.ts`: real-browser behavior checks following existing harness conventions.
- Extend existing project rendering/site tests only if markup contracts change; preserve optimized image-source assertions.

**Interfaces:**
- Consumes existing `.project-cover`, `.project-card`, `img[data-project-cover]`, `img[data-project-preview]` and `data-loaded` hooks; `htmx:after:swap` plus cleanup as needed.
- Produces decorative-only DOM/style state, never changes image `src`, `srcset`, `loading` or the original artwork. The designer chooses the smallest state attributes/classes and documents them in test assertions.

- [x] **Step 1: Add failing browser checks before production edits.** Verify no movement when idle/reduced-motion, visible movement on hover/focus after decode, page in-view activation, offscreen/hidden pause, failed-image fallback, coarse-pointer/static cards and repeated HTMX replacement without duplicate layers. Name which missing production behavior causes the first failure.
- [x] **Step 2: Run those checks against the unchanged implementation.** Save the expected red result under `.slim/deepwork/animate-project-images/`; failure must be missing motion, not broken fixture/server setup.
- [x] **Step 3: Implement the smallest designer-owned shared enhancement.** Keep visuals restrained and pixel-art-compatible. Use the existing browser APIs rather than a framework/build entry for the chat bundle. Preserve all static and lazy-loading contracts.
- [x] **Step 4: Run focused checks to green.** Capture desktop idle/active, detail, narrow/mobile and reduced-motion screenshots, plus machine-readable motion-state results. Preserve local failed-image and later-image fixtures.
- [x] **Step 5: Run full repository checks.** `bun test`, `bun run lint`, existing typecheck/build commands where supported, existing gallery/motion browser harnesses, and the new image-motion browser checks. Record genuine pre-existing failures rather than hiding them.

## Task 2: Reconcile and ship

- [x] Coordinator inspects every changed file, confirms no API/key/dependency work, and independently runs final checks.
- [x] Observer checks full-path screenshots for actual visual quality; designer corrects any visual findings.
- [ ] Record the authored-motion decision and implementation/spec pointer on the tracker, preserving historical decisions and closing obsolete video-only tickets as not planned.
- [ ] Follow the owner's full-send workflow: requested feedback, scoped commit, up-to-date PR, CI/review findings addressed, merge only through normal repository protection. No unrelated production changes.

**Coordinator calls:** hover/focus on cards, visible-page activation, coarse-pointer static cards, shared future-image behavior, no per-project effect map, no additional provider calls. These are conservative implementation defaults based on prior interaction choices, not a new provider decision.

**Observed verification:** 228 Bun tests; nine new browser checks; existing gallery suite (seven real, eighteen fixture, nine asset cases); existing page-motion suite; eight changed files biome-clean. Full-repository lint reports fourteen errors/ten warnings and typecheck reports six diagnostics, all reproduced on the clean fixed-point archive (typecheck output identical). No unrelated fixes are included.
