---
status: accepted
date: 2026-07-26
source: docs/superpowers/specs/2026-07-25-repo-restructure-and-caddy-design.md, commit 8fed037
---

# Server-rendered templates and htmx, with no client framework

Pages are HTML strings assembled on the server by `renderLayout()` in `apps/site/site.ts`, and interaction comes from htmx 4 plus small inline scripts; there is no React, Vue or Svelte runtime and no front-end build step, so the deployed artefact is the source. The rejected alternative was a component framework for the admin editor, the one genuinely stateful screen. It was refused because it would add a build, a client bundle and a second rendering model to a site whose pages are otherwise static text. The consequence is that interactive behaviour is hand-wired in event attributes, which is why conventions such as `onMouseDown` exist and why the assistant client is the only bundled browser code.
