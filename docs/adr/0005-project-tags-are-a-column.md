---
status: accepted
date: 2026-10-21
source: docs/superpowers/specs/2026-10-21-admin-projects-design.md, commit c0f1029
---

# Project tags are a column, not a line in the body

Tags are a `text[]` column on `projects` and are edited on `/admin`; a card's tags come from that column and nowhere else. Before this, tags were parsed out of a `Stack: A, B, C` line inside the project's HTML body. Keeping the body as the source of truth was rejected because it made tags unqueryable and impossible to edit without rewriting prose. Existing `Stack:` lines were migrated once by `0002_move_stack_lines_to_tags.sql` and `stack-tags.ts` was deleted, so there is no code path back to parsing.
