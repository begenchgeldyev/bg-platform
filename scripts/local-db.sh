#!/usr/bin/env bash
# Starts the local Postgres, writes DATABASE_URL into the untracked .env.local
# files Bun loads after .env, then applies migrations and seeds. Safe to re-run:
# it converges the container, the env files and the schema.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
port=${POSTGRES_PORT:-5433}
url="postgres://begench:begench@127.0.0.1:${port}/begenchgeldyev"

write_env() {
  local file=$1 rel=${1#"$root"/} tmp status=0
  tmp=$(mktemp)
  if [ -f "$file" ]; then
    grep -v '^DATABASE_URL=' "$file" >"$tmp" || status=$?
    if [ "$status" -gt 1 ]; then
      rm -f "$tmp"
      echo "cannot read $rel; leaving it untouched" >&2
      return 1
    fi
  fi
  printf 'DATABASE_URL=%s\n' "$url" >>"$tmp"
  if [ -f "$file" ] && cmp -s "$tmp" "$file"; then
    rm -f "$tmp"
    return 0
  fi
  mv "$tmp" "$file"
  echo "wrote DATABASE_URL to $rel"
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
