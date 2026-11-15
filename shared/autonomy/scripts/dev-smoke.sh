#!/usr/bin/env bash
# REQ-CORE-005/006 smoke on the dev tables (see dev-smoke.ts). Cleans up every row it creates.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../../.."
out="$(mktemp -d)"
"$root/shared/core/node_modules/.bin/esbuild" "$here/dev-smoke.ts" --bundle --platform=node --format=esm --outfile="$out/dev-smoke.mjs" --log-level=warning
(cd "$out" && node dev-smoke.mjs)
