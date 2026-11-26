#!/usr/bin/env bash
# Starts the local Postgres, writes DATABASE_URL into the untracked .env.local
# files Bun loads after .env, then applies migrations and seeds.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
port=${POSTGRES_PORT:-5433}
url="postgres://begench:begench@127.0.0.1:${port}/begenchgeldyev"

echo "starting local postgres on 127.0.0.1:${port}"
docker compose -f "$root/infra/compose.local.yml" up -d --wait postgres

for dir in apps/site packages/core; do
  file="$root/$dir/.env.local"
  if [ ! -e "$file" ]; then
    printf 'DATABASE_URL=%s\n' "$url" >"$file"
    echo "created ${file#"$root"/}"
  elif ! grep -q '^DATABASE_URL=' "$file"; then
    printf 'DATABASE_URL=%s\n' "$url" >>"$file"
    echo "added DATABASE_URL to ${file#"$root"/}"
  fi
done

(
  cd "$root/packages/core"
  DATABASE_URL="$url" bun run db:migrate
  DATABASE_URL="$url" bun run db:seed
)

echo "local database ready: $url"
