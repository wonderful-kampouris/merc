#!/usr/bin/env bash
# WP-APP-08: ONE commit to dev functions.git with fresh bundles for the given app-callable functions whose dev folder
# is still the platform template (folders a builder already deployed are skipped, never overwritten).
# fetch + rebase + push retries; never force-push. Usage: batch-push.sh <clone-dir> <slug>...
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; C="$1"; shift
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
cd "$C" && git fetch -q origin && git checkout -q -B main origin/main && git reset -q --hard origin/main && git clean -fdq
todo=(); for s in "$@"; do [ -d "functions/$s" ] && [ ! -f "functions/$s/handler.gen.js" ] && todo+=("$s"); done
[ ${#todo[@]} -gt 0 ] || { echo "nothing to do"; exit 0; }
(cd "$ROOT/shared/handlers" && node --experimental-strip-types --no-warnings "$ROOT/evidence/WP-APP-08/stage-bundle.ts" "$STAGE" "${todo[@]}") >/dev/null || exit 1
for s in "${todo[@]}"; do rsync -a --delete --exclude .git --exclude node_modules "$STAGE/$s/" "functions/$s/"; done
python3 -I "$ROOT/scripts/secret-scan.py" --root "$C/functions" >/dev/null || { echo "secret scan failed"; exit 4; }
git add -A -- $(printf 'functions/%s ' "${todo[@]}")
git diff --cached --quiet && { echo "no changes"; exit 0; }
echo "staging ${#todo[@]} folders: ${todo[*]}"; git diff --cached --shortstat
git commit -q -m "deploy ${#todo[@]} Merc functions (fresh bundles) via WP-APP-08 integration"
for i in $(seq 1 30); do
  git fetch -q origin; git rebase -q origin/main 2>/dev/null || { git rebase --abort; echo "rebase conflict"; exit 3; }
  if git -c http.postBuffer=524288000 push -q origin HEAD:main 2>"$STAGE/err"; then echo "pushed $(git rev-parse --short HEAD) to dev main (attempt $i)"; exit 0; fi
  echo "attempt $i: $(tail -1 "$STAGE/err")"
  git fetch -q origin; if git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then echo "landed despite error: $(git rev-parse --short HEAD)"; exit 0; fi
  sleep $((5 + RANDOM % 10))
done; exit 1
