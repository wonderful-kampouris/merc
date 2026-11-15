#!/usr/bin/env bash
# WP-APP-08: provision app-callable functions that have a monorepo folder but no function record on dev
# (wful functions api create; same call infra/deploy/deploy.sh makes on a first --push). Skips existing ones.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
W(){ wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464 "$@"; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
W functions api list --json > "$T/list.json"
for s in "$@"; do
  cfg="$ROOT/functions/$s/config.json"
  m=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1])).get("method","POST"))' "$cfg")
  desc=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1])).get("description",""))' "$cfg")
  if python3 -I -c 'import json,sys
d=json.load(open(sys.argv[1])); d=d if isinstance(d,list) else (d.get("data") or d.get("items") or [])
sys.exit(0 if any((f.get("path_slug") or f.get("slug"))==sys.argv[2] for f in d) else 1)' "$T/list.json" "$s"; then echo "exists $s"; continue; fi
  if W --no-interactive functions api create --slug "$s" --method "$m" --name "$s" --description "$desc" --dir "$T/$s" --skip-install >"$T/$s.log" 2>&1; then
    echo "provisioned $s $m"; else echo "FAILED $s: $(tail -2 "$T/$s.log" | tr '\n' ' ')"; fi
done
