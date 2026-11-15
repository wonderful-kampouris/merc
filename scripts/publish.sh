#!/usr/bin/env bash
# Publish a clean snapshot of this monorepo to the submission repo.
# Nested platform repos (app/.git, infra/deploy/.cache, spikes/*) would become
# empty gitlinks if committed in place, so we export without .git dirs, caches,
# node_modules and raw scraped pages, then commit + push from the export.
# Usage: scripts/publish.sh ["commit message"]   (re-runnable)
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${MERC_PUBLISH_DIR:-$HOME/Documents/merc-submission}"
REMOTE="${MERC_PUBLISH_REMOTE:-https://github.com/wonderful-kampouris/merc.git}"
MSG="${1:-Merc snapshot $(date '+%Y-%m-%d %H:%M')}"

mkdir -p "$OUT"
rsync -a --delete \
  --exclude='/.git/' --exclude='.git' --exclude='node_modules' --exclude='.cache' \
  --exclude='dist' --exclude='.DS_Store' --exclude='*.log' --exclude='.env*' \
  --exclude='__pycache__' --exclude='spikes/*/raw' --exclude='infra/seed/phones.json' --exclude='infra/seed/wuid.json' \
  "$SRC/" "$OUT/"

cd "$OUT"
[ -d .git ] || { git init -q -b main; git remote add origin "$REMOTE"; }
git add -A
if git diff --cached --quiet; then echo "nothing to publish"; exit 0; fi
git commit -q -m "$MSG"
git push -q -u origin main
echo "published $(git rev-parse --short HEAD) -> $REMOTE"
