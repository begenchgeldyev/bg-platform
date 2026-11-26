#!/usr/bin/env bash
# One canonical preview port (8613) for whatever checkout you are in: converges
# the local database, stops the process holding the port, starts the dev server
# and waits until it answers.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
port=8613
log=${PREVIEW_LOG:-/tmp/opencode/preview.log}

"$root/scripts/local-db.sh"

mkdir -p "$(dirname "$log")"
: >"$log"
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  sleep 1
fi
if curl -fsS -m 2 "http://127.0.0.1:${port}/api/version" >/dev/null 2>&1; then
  echo "port ${port} answered after fuser; stop the process holding it and retry (ss -ltnp | grep :${port})" >&2
  exit 1
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
