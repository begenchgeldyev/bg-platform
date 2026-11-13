---
status: accepted
date: 2026-10-21
source: docs/superpowers/specs/2026-10-21-admin-projects-design.md, commit 035710d
---

# A project image is a data URL in the project row

The admin form reads the chosen file in the browser and saves it into the project's `image` column as a data URL, capped at 2 MB. Storing images as files under `public/` was considered and left out: it would need an upload endpoint, path handling, and a cleanup story for deleted projects and replaced images, which is a file store pretending to be a column. The cost is that a project row carries its image bytes and the editor cannot be saved on a slow connection for large pictures — hence the cap.
