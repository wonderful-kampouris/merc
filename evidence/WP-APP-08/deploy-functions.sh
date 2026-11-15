#!/usr/bin/env bash
# WP-APP-08 integration deploy: push every app-callable Merc function to dev with a fresh bundle, through the
# sanctioned infra/deploy/deploy.sh (replaces only functions/<slug>/ in functions.git; never force-pushes).
# Wave 2 commits were made in deploy caches but their pushes were rejected by races and never retried,
# so dev still ran the platform template. Usage: deploy-functions.sh <slug>...
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
cd "$ROOT/shared/handlers"
node --experimental-strip-types --no-warnings "$ROOT/evidence/WP-APP-08/stage-bundle.ts" "$STAGE" "$@" || exit 1
for s in "$@"; do
  for try in 1 2 3 4 5; do
    out="$("$ROOT/infra/deploy/deploy.sh" "fn:$s" --env dev --push --src "$STAGE/$s" \
      --message "deploy function $s (fresh bundle) via WP-APP-08 integration" 2>&1)"; rc=$?
    if [ $rc = 0 ]; then echo "$s: $(echo "$out" | grep -E '^(pushed|no changes|provisioned)' | tr '\n' ' ')"; break; fi
    echo "$s: try $try failed rc=$rc: $(echo "$out" | tail -2 | tr '\n' ' ')"; sleep $((try*3))
  done
done
