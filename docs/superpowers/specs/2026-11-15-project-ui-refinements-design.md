# Project UI refinements

## Approved scope

Implement on `main`. Preserve the site's existing terminal style and EN/RU
language behavior. These changes supersede the earlier path-heading design
where that design required the Resume download on a separate row or preserved
the displayed case of a project heading.

### Resume heading

Place the existing PDF download immediately to the right of `~/resume` in the
same heading row, with the normal cursor attached to the heading. Remove the
old separate action row and its extra vertical space. Keep the canonical PDF
URL, download behavior, bilingual label, heading divider and mobile gutters.
Allow the action to wrap only when the viewport cannot accommodate it.

### Home page

Remove the `stack: … | now: …` strip in both languages. Preserve the Terminal
and remaining home content.

Make the home footer email a keyboard-accessible copy control. Activation
copies exactly `begenchgeldyev@gmail.com` and briefly announces a localized
success status without changing the layout. Prefer immediate pointer
activation consistent with the repository, while supporting keyboard and
touch without duplicate clipboard writes. Announce a localized failure when
clipboard access is unavailable or rejected; never show false success. Leave
the email visible/selectable and other contact links unchanged. Ensure the
behavior survives HTMX navigation without duplicated handlers.

### Project heading

Render the name lowercase, visually joined to the prefix:
`~/project/pantheon`. Remove the gap after the slash, retaining the established
cursor styling. As clarified on November 16, both the project-detail prefix
and name are light gray (`#f2f1f0`); the cursor remains green. Other page
prefix colors are unchanged. All path headings have no prefix/name gap;
retain 8px cursor spacing and 16px Resume action spacing.
Lowercase is presentation only: preserve stored names, route
identity and raw inline-edit/save values. Long and Cyrillic names wrap without
truncation or horizontal overflow; decorative prefix/cursor stay outside the
editable name.

### Project destination links

Replace the public detail sidebar's `[METADATA]` panel and its Project ID,
Created, Updated, Visibility and Route boxes with a `[LINKS]` panel containing
up to two accessible external links: GitHub and Live app (localized public
labels where appropriate). Existing owner editing/image/hidden controls remain
available; removing metadata must not remove write functionality.

Links use the existing terminal palette and outline treatment with visible
keyboard focus and adequate targets. Open in a new tab using
`rel="noopener noreferrer"`, with an accessible new-tab indication. Hide each
missing or invalid destination independently. Omit an empty public panel and
its spacing when neither destination exists; do not leave a vacant desktop
column. Keep owner controls visible even when no destinations are configured.

Add optional `githubUrl` and `liveUrl` fields, editable in Admin with labels,
limits and actionable validation feedback. GitHub accepts absolute HTTPS
`github.com` repository URLs (owner/repository path, optional deeper path).
Live app accepts absolute HTTP(S) URLs. Trim whitespace; reject credentials,
control characters, malformed URLs and values over 2,048 characters. Use the
same validation rules at save and defensively at render; escape href values.
There are no reachability checks, fetches, GitHub API calls or inferred URLs.

Create defaults absent/null/blank URLs to null. PATCH omission preserves the
stored value; null/blank clears it. Persist as nullable text columns via a
committed generated Drizzle migration with metadata. Existing projects start
with null destinations; do not backfill guessed links, seed production or
modify existing body links. Admin's existing portfolio-page 'View live' action
must not be confused with the new external Live app destination.

## Boundaries and invariants

- Reuse existing project CRUD, authorization and public package entry points.
- No new route, permission model, card links, preview service or inline link
  editor. Editing these two fields is through Admin.
- Preserve hidden-project access behavior and all existing project content.
- No unrelated visual redesign, infra edits or production writes in this task.
- Update the canonical Project vocabulary to mention optional destination URLs.

## Verification

Write focused parser/rendering/persistence/Admin tests before implementation,
covering both/neither/single destination, invalid DB URLs, escaping, omitted
PATCH fields and clearing. Update typed fixtures for the new nullable columns.
Verify generated migration adds only the two nullable columns and applies to
an isolated local database if available; never use production for test setup.

Use existing self-contained browser fixtures to check EN/RU desktop/mobile:
Resume button placement, no slash/name gap, lowercase green display with
case-preserving edit/save, no home strip, email pointer/keyboard success and
failure, safe project links, empty-panel layout and Admin hydration/reset/save.
Use the task-specific agent-browser session and no AI requests/Admin writes
against production. Run focused Bun tests, CSS build, changed-file lint and
dependency-boundary checks; distinguish established baseline failures from
regressions. Review final writer artifacts before a final validation pass.

## Delivery

Implementation is on main as requested. Report local checks and migration
limits honestly. A push would trigger production migration/deployment, so do
not infer deployment approval for these new changes from the completed,
separately authorized disk-full repair.
