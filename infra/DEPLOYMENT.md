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

### Storage failures before a build

The deployment checks the checkout filesystem for at least 1 GiB available and
1,024 free inodes before changing Git configuration or fetching. This is a
minimum safety check, not a guarantee that a Docker build will fit.

A Git error such as `failed to write new configuration file .git/config.lock`
can mean a full filesystem, not a stale lock. Inspect `df -h`, `df -i`, mount
state and file ownership before deleting locks or changing permissions. Do not
print `infra/.env`, `infra/site.env` or credential files while diagnosing.

After the dedicated policy below is installed on the VPS, syslog uses daily
rotation with a `50M` maximum-size trigger checked hourly, seven compressed
archives and the standard rsyslog reopen hook. The threshold is checked
periodically; it is not a hard cap between checks. Seven archives means seven
rotations, not necessarily seven days. Other logs retain their existing
policies. Use logrotate rather than a cron job that
deletes an active log: unlinking an open file may not reclaim space and can
discard diagnostics without safely reopening the logger.

The versioned configuration templates are `infra/logrotate/syslog.conf` and
`infra/systemd/syslog-logrotate.{service,timer}`. During server provisioning,
install the policy as `/etc/logrotate-syslog.conf` (outside the global include
directory), and remove only `/var/log/syslog` from the existing rsyslog stanza
in `/etc/logrotate.d/rsyslog`. Leave the other paths/directives and global
`logrotate.timer` unchanged. Install the two units in `/etc/systemd/system/`.
The dedicated service uses `/var/lib/logrotate/syslog-bounded.status`; use that
same state file for manual invocations to preserve locking/history.
Its standalone policy explicitly retains the VPS's global `su root adm`
identity because it does not inherit `/etc/logrotate.conf` defaults; the new
active log is still created as `syslog:adm`.

Back up the affected configuration before changing it, ensure no rotation is
running, and validate before activation:

```sh
logrotate --debug /etc/logrotate.conf
logrotate --debug --state /var/lib/logrotate/syslog-bounded.status /etc/logrotate-syslog.conf
systemd-analyze verify /etc/systemd/system/syslog-logrotate.service /etc/systemd/system/syslog-logrotate.timer
systemctl daemon-reload
systemctl start syslog-logrotate.service
systemctl enable --now syslog-logrotate.timer
systemctl list-timers syslog-logrotate.timer
```

Before the first rotation of an already-large log, check free space: compression
writes the archive before releasing the original file's blocks. If necessary,
measure compressed output with `gzip -c /var/log/syslog | wc -c` without writing
an extra archive, and retain room for concurrent growth. Do not force rotation
or truncate the active log to bypass a capacity problem. Confirm the service
succeeded, the new active file is owned by `syslog:adm`, rsyslog reopened it,
and the next timer run is scheduled. For rollback, disable the dedicated timer,
wait for rotation to finish, restore the original stanza, then disable/remove
the dedicated policy and units. Never leave both policies rotating syslog.

For emergency recovery, inspect archive metadata/open references and
`docker system df` first. Removing a specifically approved closed archive or
unused build cache is different from deleting application data. Never
automatically prune volumes, stop containers, delete swapfiles or remove files
belonging to another application. Freeing space does not by itself prove that
deployment recovered: verify the successful run and its target SHA afterward.

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
