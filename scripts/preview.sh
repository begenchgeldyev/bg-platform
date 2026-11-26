#!/usr/bin/env bash
# One canonical preview port (8613) for whatever checkout you are in: converges
# the local database, stops the process holding the port, starts the dev server
# against that same database and waits until this launch bound the port.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
port=8613
log=${PREVIEW_LOG:-/tmp/opencode/preview.log}

db_log=$("$root/scripts/local-db.sh")
printf '%s\n' "$db_log"
url=${db_log##*local database ready: }
if [ "$url" = "$db_log" ]; then
  echo "local-db did not report a database URL" >&2
  exit 1
fi

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

(cd "$root/apps/site" && DATABASE_URL="$url" PORT="$port" exec setsid --fork bun run dev) >>"$log" 2>&1 </dev/null

for _ in $(seq 1 40); do
  if grep -qE 'EADDRINUSE|Failed to start server' "$log" 2>/dev/null; then
    echo "port ${port} was already taken; another process won the race. Log:" >&2
    tail -20 "$log" >&2
    exit 1
  fi
  if grep -q 'Server running at' "$log" 2>/dev/null && curl -fsS -m 2 "http://127.0.0.1:${port}/api/version" >/dev/null 2>&1; then
    echo "preview: http://localhost:${port}  (log: $log)"
    exit 0
  fi
  sleep 1
done

echo "preview did not answer on port ${port}; last log lines:" >&2
tail -20 "$log" >&2
exit 1
