#!/usr/bin/env bash
# Read-only WP-CRD-02 smoke on the dev tables (see dev-smoke.ts). Writes nothing, messages no one.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
out="$(mktemp -d)"
"$root/shared/core/node_modules/.bin/esbuild" "$here/dev-smoke.ts" --bundle --platform=node --format=esm --outfile="$out/dev-smoke.mjs" --log-level=warning
(cd "$out" && node dev-smoke.mjs)
