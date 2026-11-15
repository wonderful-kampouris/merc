#!/usr/bin/env bash
# WP-APP-08: which function folders on the dev workspace functions.git main still hold only the platform
# template (no handler.gen.js => `return {}`), i.e. a Merc deploy push never landed. Read-only.
set -euo pipefail
DIR="$(mktemp -d)"; trap 'rm -rf "$DIR"' EXIT
git clone -q --depth 1 https://vcs.greece-hackathon.sb.wonderful.ai/git/workspaces/7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464/functions.git "$DIR/f"
cd "$DIR/f"; echo "functions.git main at $(git rev-parse --short HEAD)"
for d in functions/*/; do s=$(basename "$d"); if [ -f "$d/handler.gen.js" ]; then echo "bundled  $s"; else echo "TEMPLATE $s"; fi; done | sort
