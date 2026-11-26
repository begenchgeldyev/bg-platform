#!/usr/bin/env bash
# Runs the Playwright checks in apps/site/tests against a running site.
# Override SITE_URL, PLAYWRIGHT_MODULE, CHROMIUM_PATH or EVIDENCE_DIR when needed.
# Each suite writes to its own subdirectory of EVIDENCE_DIR.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
export SITE_URL=${SITE_URL:-http://localhost:8613}
export EVIDENCE_DIR=${EVIDENCE_DIR:-/tmp/opencode/browser-tests}

find_playwright() {
  local binary dir
  binary=$(command -v playwright) || return 1
  dir=$(dirname "$(readlink -f "$binary")")
  [ "$(basename "$dir")" = ".bin" ] && dir=$(dirname "$dir")
  [ "$(basename "$dir")" = "playwright" ] || dir="$dir/playwright"
  [ -f "$dir/index.mjs" ] || return 1
  printf '%s\n' "$dir/index.mjs"
}

if [ -z "${PLAYWRIGHT_MODULE:-}" ]; then
  PLAYWRIGHT_MODULE=$(find_playwright) || {
    echo "playwright is not installed; set PLAYWRIGHT_MODULE to its index.mjs" >&2
    exit 1
  }
  export PLAYWRIGHT_MODULE
fi

if ! curl -fsS -m 2 "${SITE_URL}/api/version" >/dev/null 2>&1; then
  echo "no site at ${SITE_URL}; run 'bun run preview' first" >&2
  exit 1
fi

echo "playwright: ${PLAYWRIGHT_MODULE}"

status=0
for file in "$root"/apps/site/tests/*.browser.ts; do
  echo "== ${file#"$root"/}"
  suite=$(basename "$file" .browser.ts)
  EVIDENCE_DIR="$EVIDENCE_DIR/$suite" bun "$file" || status=1
done

exit "$status"
