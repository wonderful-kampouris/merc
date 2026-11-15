#!/usr/bin/env bash
# Live check that merc-buddy-pro (Team Delta) can brief the rep on a shop from the public web (tool research_store).
#   scripts/test-research-store.sh                       default: a real Athens café
#   scripts/test-research-store.sh "Mind the Cup Peristeri"
# Passes when the agent calls research_store, gets sources back, and answers. No calls or messages are sent.
set -euo pipefail
WS=6f6d70c8-6864-40f6-8b70-19ddf8b8923c; AGENT=${AGENT:-merc-buddy-pro}; SHOP=${1:-Taf Coffee Athens}
OUT="${TMPDIR:-/tmp}/merc-research-store.txt"
printf 'I am visiting a new prospect today, %s. What can you find about them online?\n' "$SHOP" \
  | wful --profile hackathon --workspace "$WS" agents chat "$AGENT" > "$OUT" 2>&1
grep -E '^(you|agent)>|^tool> research_store' "$OUT" | cut -c1-300
grep -q '^tool> research_store' "$OUT" || { echo "FAIL: research_store was not called (log: $OUT)"; exit 1; }
grep -A2 '^tool> research_store' "$OUT" | grep -q '"error":{' && { echo "FAIL: research_store returned an error (log: $OUT)"; exit 1; }
grep -q '^agent>.*' <(tail -n +3 "$OUT") || { echo "FAIL: no agent answer (log: $OUT)"; exit 1; }
echo "PASS (full log: $OUT)"
