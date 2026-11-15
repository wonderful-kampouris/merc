#!/usr/bin/env bash
# WP-APP-08: deploy fresh bundles through the platform commit API (POST /v1/wonderful-functions/:id/commit, one commit
# to main per function, the platform builds + activates it). Used because git pushes to the shared functions.git
# time out at the edge (HTTP 524, 'remote end hung up') under the wave-3 push load. Only folders whose dev copy is
# still the platform template (no handler.gen.js) are written; folders a builder already deployed are skipped.
# Usage: commit-api-deploy.sh <slug>...
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
W(){ wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464 "$@"; }
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
W functions api list --json > "$STAGE/list.json"
(cd "$ROOT/shared/handlers" && node --experimental-strip-types --no-warnings "$ROOT/evidence/WP-APP-08/stage-bundle.ts" "$STAGE" "$@") >/dev/null || exit 1
for s in "$@"; do
  id=$(python3 -I -c 'import json,sys
d=json.load(open(sys.argv[1])); d=d if isinstance(d,list) else (d.get("data") or d.get("items") or [])
print(next((f["id"] for f in d if (f.get("path_slug") or f.get("slug"))==sys.argv[2]), ""))' "$STAGE/list.json" "$s")
  [ -n "$id" ] || { echo "$s: not provisioned"; continue; }
  files=$(W call get "/api/v1/wonderful-functions/$id/files" 2>&1)
  if echo "$files" | grep -q '"handler.gen.js"'; then echo "$s: already deployed by its builder, skipped"; continue; fi
  python3 -I -c 'import json,sys
d=sys.argv[1]; print(json.dumps({"message": "deploy "+sys.argv[2]+" (fresh bundle) via WP-APP-08 integration",
 "files": [{"path": p, "content": open(d+"/"+p).read()} for p in ("index.ts","handler.gen.js")]}))' "$STAGE/$s" "$s" > "$STAGE/$s.json"
  for try in 1 2 3 4 5 6 7 8; do
    out=$(W call post "/api/v1/wonderful-functions/$id/commit" --data-file "$STAGE/$s.json" 2>&1); rc=$?
    if [ $rc = 0 ]; then echo "$s: committed $(echo "$out" | head -c 160)"; break; fi
    if W call get "/api/v1/wonderful-functions/$id/files" 2>&1 | grep -q '"handler.gen.js"'; then echo "$s: landed despite error ($(echo "$out" | tail -1 | head -c 120))"; break; fi
    echo "$s: try $try failed: $(echo "$out" | tail -1 | head -c 200)"; sleep $((try*5))
  done
done
