#!/bin/sh
# Packaging per S9 (docs/spikes/S9-S10.md §3): @merc/core ships as utils/merc_core/ of the dev workspace
# Shared Library, on branch merc-core. Agents: `wful agents lib add` + import "../../shared_lib/utils/merc_core".
# Functions: shared_lib git submodule + relative import. Never touches main.
set -eu
HERE=$(cd "$(dirname "$0")/.." && pwd)
URL=${MERC_SHARED_LIB_URL:-https://vcs.greece-hackathon.sb.wonderful.ai/git/tenants/c98854f3-3c88-5fc0-b811-dc4593044ebd/workspaces/7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464/shared_lib.git}
BRANCH=${MERC_SHARED_LIB_BRANCH:-merc-core}
TMP=$(mktemp -d)
git clone -q "$URL" "$TMP/lib"
cd "$TMP/lib"
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then git checkout -q -B "$BRANCH" "origin/$BRANCH"; else git checkout -q -B "$BRANCH" origin/main; fi
rm -rf utils/merc_core && mkdir -p utils/merc_core
cp -R "$HERE/src/." utils/merc_core/
cat > utils/merc_core/README.md <<'MD'
# merc_core (@merc/core) — generated copy, do not edit here
Source of truth: Merc monorepo `shared/core/src` (WP-CORE-01). Republish with `pnpm -C shared/core publish-lib`.
Import: `import { defineFunction, me, createDb } from "<rel>/shared_lib/utils/merc_core"`.
MD
git add -A utils/merc_core
if git diff --cached --quiet; then echo "no changes"; else git -c user.name=merc-core -c user.email=merc-core@merc.invalid commit -q -m "merc_core: @merc/core $(cd "$HERE" && git rev-parse --short HEAD 2>/dev/null || date +%s)"; fi
git push -q origin "$BRANCH"
echo "pushed $BRANCH @ $(git rev-parse HEAD)"
rm -rf "$TMP"
