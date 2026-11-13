---
status: accepted
date: 2026-07-26
source: docs/superpowers/specs/2026-07-25-repo-restructure-and-caddy-design.md
---

# Split the repo into `apps/site` and `packages/core`

The repository is one Bun workspace with two packages. `packages/core` holds everything that is not HTTP — sessions, ABAC, database access, the project repository — and `apps/site` holds routing, rendering and controllers, wiring the two together in `app-container.ts`. The split exists because the HTTP surface and the domain rules change for different reasons: keeping authorization and persistence free of `Request` objects is what lets them be tested without a server. Sharing these packages with other projects is explicitly out of scope; the boundary is for this repository only.
