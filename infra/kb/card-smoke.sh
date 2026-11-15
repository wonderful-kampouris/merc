#!/usr/bin/env bash
# fn:visit-card-get smoke on the dev tables + Context Hub KBs (see card-smoke.ts). Deletes every row it creates.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
out="$(mktemp -d)"
"$root/shared/core/node_modules/.bin/esbuild" "$here/card-smoke.ts" --bundle --platform=node --format=esm --outfile="$out/card-smoke.mjs" --log-level=warning
(cd "$out" && node card-smoke.mjs)
