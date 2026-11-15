#!/bin/sh
# Idempotently create the Merc model profiles on the dev workspace.
# Existing profiles are left untouched (never deleted or overwritten).
set -e
cd "$(dirname "$0")/.."
W="wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464"
for key in merc-extract merc-write merc-decide; do
  if $W model-profiles get "$key" --json >/dev/null 2>&1; then
    echo "$key exists: $($W model-profiles get "$key" --json | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["id"])')"
  else
    $W model-profiles create --data-file "profiles/$key.json" --json
  fi
done
