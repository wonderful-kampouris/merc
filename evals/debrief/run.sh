#!/usr/bin/env bash
# Bundle and run one eval script (TypeScript, imports shared/* sources) with node 22.
#   evals/debrief/run.sh run-dev --rep <app_user_id> [--only id,id]
#   evals/debrief/run.sh cleanup-dev --rep <app_user_id> [--dry]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
script="$1"; shift
out="$(mktemp -d)/$script.mjs"
"$ROOT/shared/handlers/node_modules/.bin/esbuild" "$HERE/$script.ts" --bundle --platform=node --format=esm --target=node22 --log-level=warning --outfile="$out"
node "$out" "$@"
