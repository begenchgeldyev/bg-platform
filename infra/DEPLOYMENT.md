# Production deployment

Run Compose from the repository root on the VPS. Only Caddy publishes host
ports (TCP 80 and 443); neither PostgreSQL nor the app publishes a host port.
Use `docker compose exec` for database maintenance, not a public database port.

## Root-only configuration

Keep `infra/.env` and `infra/site.env` untracked and mode `0600`; the repository
directory on the VPS is root-only. Never put real credentials in Git or logs.

`infra/.env` supplies Compose interpolation:

- `POSTGRES_PASSWORD`: a strong, unique initial PostgreSQL password.
- `GIT_SHA`: the full deployed source commit (an exported CI value overrides it).
- `BUN_IMAGE`, `POSTGRES_IMAGE`, `CADDY_IMAGE`: immutable `repository@sha256:…`
  references. The initial VPS deployment records its exact pins here.

`infra/site.env` supplies the app environment:

- `DATABASE_URL=postgres://begench:<same-password>@postgres:5432/begenchgeldyev`
- `ADMIN_SECRET`: a separate strong random admin password/session signing key.
- `PORT=8613`
- `OPENAI_API_KEY=`: optional; the site works without AI access.

Changing `POSTGRES_PASSWORD` alone does not change an existing database role's
password. Changing `ADMIN_SECRET` invalidates existing admin sessions.

## Deployment order

```sh
export GIT_SHA="$(git rev-parse HEAD)"
docker compose -f infra/compose.yml config --quiet
docker compose -f infra/compose.yml build site
docker compose -f infra/compose.yml up -d --wait postgres
docker compose -f infra/compose.yml run --rm --no-deps \
  -w /usr/src/app/packages/core site bun run db:migrate
docker compose -f infra/compose.yml up -d --wait
```

The image includes Drizzle Kit, its configuration, and the checked-in migrations.
The migration journal makes repeated `db:migrate` invocations safe; migrations
must succeed before replacing the site container. Do not generate migrations,
use `db:push`, or automatically seed on ordinary deployments.

For **initial provisioning only**, after migrations:

```sh
docker compose -f infra/compose.yml run --rm --no-deps \
  -w /usr/src/app/packages/core site bun run db:seed
```

This creates the owner, initial authorization policy, and portfolio projects.
The initial seed is idempotent by project name, but a renamed seed project could
be added again; it is not an automatic synchronization mechanism.

`infra/Dockerfile.production` installs the frozen Bun workspace and includes
the inherited root TypeScript configuration for consistent compiler settings. Its
base runtime can be pinned without modifying application code. The image label
and `/api/version` carry `GIT_SHA`. App and database healthchecks control startup
order; all services restart unless explicitly stopped, with bounded Docker logs.

## DNS and TLS

The Caddy configuration is for `begenchgeldyev.com` and
`www.begenchgeldyev.com`; www redirects to the apex. Point DNS at the new VPS,
including removing stale AAAA records if IPv6 is not configured. Caddy obtains
trusted certificates automatically once ACME can reach this host. HTTP 308
redirects alone prove HTTP routing, not that DNS or trusted HTTPS is ready.
The Caddy container also has an HTTP readiness listener on its own loopback
port 8080. It is not published on the host and is used only by its healthcheck
to verify the reverse-proxy path independently of DNS and certificate issuance.

Admin login is at `/admin`, password-only. The initial credential is available
to root in `/root/bg-platform-admin-credentials.txt` on the VPS. Retrieve it
privately over SSH or SCP; never paste it in deployment output.
