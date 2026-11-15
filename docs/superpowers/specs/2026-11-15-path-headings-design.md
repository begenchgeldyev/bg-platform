# Shared path headings for Logs, Resume and project pages

## Approved scope

Extend the existing Projects path-heading treatment to Logs, Resume and individual project pages. Replace old introductory headings instead of adding a second title. Preserve all unrelated page content and behavior.

The new visible paths are identical in English and Russian:

- Logs: `~/logs`.
- Resume: `~/resume`.
- Individual project: `~/project/` followed by the exact stored project name, preserving case, spaces, punctuation and Cyrillic.

These are display headings, not route changes. Individual project URLs remain `/projects/:id`. The existing Projects page and its translated heading remain visually unchanged.

## Visual design

Use the existing Projects heading as the source of truth: green `~/` prefix, light path text, green filled block cursor, compact monospace typography and bottom divider. Retain its 24px desktop / 21px small-screen sizes, two-second stepped cursor animation and static cursor under reduced motion.

Match Projects' page-level top spacing and horizontal gutters on the affected pages, including mobile (`px-5 sm:px-8 py-12 md:py-16`). Do not redesign the body cards or their layout.

Project names must remain completely visible. Wrap at normal text boundaries with an anywhere-break fallback for long unbroken names. Keep the cursor after the final line; do not truncate names or introduce horizontal scrolling. Keep one accessible H1 per page and hide decorative prefix/cursor from assistive technology, consistent with Projects.

## Page-specific changes

### Logs

Replace the `[BLOG ACTIVE]` badge, `My_Reflections` title and introductory subtitle with the shared `~/logs` heading. Keep the separate fetch-command indicator, loading state and remaining content unchanged. The unrelated missing Logs endpoint is out of scope.

### Resume

Replace the Resume badge, large personal-name title and introductory roles line with `~/resume`. Preserve the existing PDF link, download behavior and translated label. Place that button in its own right-aligned row below the heading/divider. Preserve the Resume content and existing compatibility URLs.

Keep introductory markup in the existing partial rather than injecting decorative text into the raw Resume fragment consumed by AI grounding. No AI requests are required for validation.

### Individual project

Place the path heading across the full main width, above the existing Back to projects link and content grid. Move the sole name H1 out of the description card; preserve description, tags, editor hint, images, body, metadata and owner controls. Remove only title-dependent spacing left behind in the description card.

The name element retains `data-project-field="name"`, `spellcheck="false"` and a name-only text value. Prefix and cursor are siblings outside the editable field: the editor saves this element's `textContent`. Preserve existing escaped rendering, document title generation, authorization and route behavior. No editor-script redesign is needed.

## Implementation approach

Extract the Projects path-heading CSS from `apps/site/components/projects/gallery.html` into the shared styling location used by the server-rendered pages. Reuse that styling for all affected headings, with a narrow wrapping adaptation for project detail. Keep existing Projects hooks where useful to avoid unnecessary test or markup churn.

Use existing HTML fragments and SSR include substitution. No package, framework, new component system or unrelated refactoring is needed. Duplicating the CSS was rejected because heading variants would drift; introducing a general component API was rejected as excessive for this change.

Relevant implementation locations:

- `apps/site/pages/logs.html` and `logs.ru.html`.
- `apps/site/pages/resume.html` and `resume.ru.html`.
- `apps/site/components/header.html` (Resume-only intro).
- `apps/site/components/projects/page.html` (individual project).
- `apps/site/components/projects/gallery.html` and shared head/styles.

## Verification and acceptance

Update focused SSR tests to check the agreed headings in both languages, one H1, removed old intro markup and retained PDF link. Existing project tests must continue to prove name-only H1 contents, safe escaping and unchanged route/title behavior. Preserve tests for Resume aliases and bilingual downloads.

Use local browser checks for matters HTML assertions cannot establish: matching heading geometry, cursor/reduced-motion behavior, full-width project placement and long-name wrapping at narrow widths. Reuse or extend existing path-heading browser checks. Verify editable name behavior through local test fixtures; do not perform Admin writes against a running site without explicit authorization. No production access or Terminal AI requests.

Run focused Bun tests for touched rendering/controller areas, repository lint and boundary checks after reconciling edits. Record exact commands and outcomes; unrelated pre-existing failures must be distinguished from regressions. Browser checks supplement rather than replace Bun validation.

## Non-goals

- No project URL changes, slug generation or name translation.
- No changes to global navigation or Projects page appearance.
- No Logs API implementation or content redesign.
- No authorization, database or AI behavior changes.

## Approval

The user confirmed replacement, preservation of the PDF action/content, Projects-aligned spacing, full-width project placement, exact stored names with wrapping, and the final design summary during the interview.
