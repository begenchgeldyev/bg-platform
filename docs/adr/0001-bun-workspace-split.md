---
status: accepted
date: 2026-07-26
source: docs/superpowers/specs/2026-07-25-repo-restructure-and-caddy-design.md
---

# Split the repo into `apps/site` and `packages/core`

The repository is one Bun workspace with two packages. `packages/core` owns the domain and its storage — the Drizzle schema and migrations, the database client, the ABAC pipeline, the DI container and the project repository — and `apps/site` owns everything HTTP and HTML: `Bun.serve()` routes, the SSR renderer, page fragments and controllers. The previous layout kept all of it in one `backend/` folder with nothing enforcing the seam; the split makes ownership explicit and gives the domain one import root. It is a boundary of ownership, not a purity rule: `pep.ts` and `session.ts` still accept a `Request` to read the session cookie. Reusing these packages in another project is explicitly out of scope.
