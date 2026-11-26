#!/usr/bin/env bash
# Starts the local Postgres, writes DATABASE_URL into the untracked .env.local
# files Bun loads after .env, then applies migrations and seeds. Safe to re-run:
# it converges the container, the env files and the schema.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
port=${POSTGRES_PORT:-5433}
url="postgres://begench:begench@127.0.0.1:${port}/begenchgeldyev"

write_env() {
  local file=$1 rel=${1#"$root"/}
  if [ ! -f "$file" ]; then
    printf 'DATABASE_URL=%s\n' "$url" >"$file"
    echo "created $rel"
  elif grep -qx "DATABASE_URL=$url" "$file"; then
    return
  elif grep -q '^DATABASE_URL=' "$file"; then
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$url|" "$file"
    echo "updated DATABASE_URL in $rel"
  else
    printf 'DATABASE_URL=%s\n' "$url" >>"$file"
    echo "added DATABASE_URL to $rel"
  fi
}

echo "starting local postgres on 127.0.0.1:${port}"
docker compose -f "$root/infra/compose.local.yml" up -d --wait postgres

write_env "$root/apps/site/.env.local"
write_env "$root/packages/core/.env.local"

(
  cd "$root/packages/core"
  DATABASE_URL="$url" bun run db:migrate
  DATABASE_URL="$url" bun run db:seed
)

echo "local database ready: $url"
