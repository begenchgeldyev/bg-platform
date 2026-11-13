---
status: accepted
date: 2026-11-08
source: infra/DEPLOYMENT.md, commit 2ebe722
---

# Migrations and seeds are run by hand, before the deploy that needs them

Schema changes are generated into `packages/core/drizzle/migrations` and applied with `bun run db:migrate` from an SSH tunnel to the VPS's loopback Postgres; the seed is likewise run by hand. No deploy step generates migrations, pushes the schema or seeds. The reason is not taste: production Postgres listens only on `127.0.0.1`, so an unattended deploy-time migration would turn a schema mistake into an outage with no operator in the loop, and the seed is idempotent by project name only, so running it on deploy would silently re-add renamed projects. The consequence is that shipping a migration is two ordered steps performed by the owner, and code must never assume its migration has run.
