#!/usr/bin/env bash
# One canonical preview port (8613) for whatever checkout you are in: stops the
# process holding the port, ensures a local database, starts the dev server and
# waits until it answers.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
port=${PREVIEW_PORT:-8613}
log=${PREVIEW_LOG:-/tmp/opencode/preview.log}

has_database_url() {
  local file
  for file in "$root/apps/site/.env" "$root/apps/site/.env.local"; do
    if [ -f "$file" ] && grep -q '^DATABASE_URL=' "$file"; then
      return 0
    fi
  done
  return 1
}

has_database_url || "$root/scripts/local-db.sh"

mkdir -p "$(dirname "$log")"
: >"$log"
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  sleep 1
fi

(cd "$root/apps/site" && PORT="$port" exec setsid --fork bun run dev) >>"$log" 2>&1 </dev/null

for _ in $(seq 1 40); do
  if curl -fsS -m 2 "http://127.0.0.1:${port}/api/version" >/dev/null 2>&1; then
    echo "preview: http://localhost:${port}  (log: $log)"
    exit 0
  fi
  sleep 1
done

echo "preview did not answer on port ${port}; last log lines:" >&2
tail -20 "$log" >&2
exit 1
