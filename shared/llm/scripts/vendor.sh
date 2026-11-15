#!/bin/sh
# Copy shared/llm (+ the generated contract schemas/types it needs) into a
# function folder as _shared/, so the platform build can bundle it.
# deploy.sh copies folders and does not build (docs/spikes/repo-layout.md).
#   sh shared/llm/scripts/vendor.sh <function-folder>
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
DEST="${1:?usage: vendor.sh <function-folder>}"
rm -rf "$DEST/_shared/llm" "$DEST/_shared/contracts"
mkdir -p "$DEST/_shared/llm" "$DEST/_shared/contracts"
cp "$HERE"/src/*.ts "$DEST/_shared/llm/"
cp "$ROOT/packages/contracts/src/generated/schemas.ts" "$ROOT/packages/contracts/src/generated/types.ts" "$DEST/_shared/contracts/"
sed -i.bak 's#\.\./\.\./\.\./packages/contracts/src/generated/#../contracts/#' "$DEST/_shared/llm/contracts.ts" && rm "$DEST/_shared/llm/contracts.ts.bak"
grep -q '"../contracts/schemas.js"' "$DEST/_shared/llm/contracts.ts" || { echo "vendor: import rewrite failed" >&2; exit 1; }
echo "vendored shared/llm into $DEST/_shared"
