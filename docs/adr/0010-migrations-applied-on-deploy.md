---
status: accepted
date: 2026-11-08
source: .github/workflows/deploy.yml, infra/DEPLOYMENT.md, commit 2ebe722
---

# Schema changes ship as committed migrations, and the deploy applies them

Migrations are generated into `packages/core/drizzle/migrations` and committed together with the code that needs them. The deploy pipeline builds the new image, starts Postgres, runs `db:migrate` with that new image, and only then replaces the site container and verifies that the live site serves the pushed commit. Generating migrations during a deploy and `db:push` are banned, and seeding never runs automatically. The fixed order is the point: a migration that fails stops the deploy before any new code serves traffic, and the migration journal makes repeated runs safe. Seeding stays a provisioning step because the seed is idempotent by project name only, so running it on every deploy would silently re-add projects the owner had renamed.
