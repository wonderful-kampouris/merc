#!/usr/bin/env bash
# Sync procedures/import-pipeline/automation.json to the dev procedure `merc-import-pipeline`, validate, and (with
# --publish) publish it and point global variable MERC_IMPORT_PROCEDURE_ID at it so fn:import-start invokes it.
#   procedures/import-pipeline/deploy.sh            # commit the draft + validate
#   procedures/import-pipeline/deploy.sh --publish  # ... and publish + set the global variable
# infra/deploy has no procedure component yet; this script is the WP-IMP-01 stand-in (dev workspace only).
set -euo pipefail
WS=7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464
W() { wful --profile hackathon --workspace "$WS" "$@"; }
HERE="$(cd "$(dirname "$0")" && pwd)"
PROC=${MERC_IMPORT_PROCEDURE_ID:-20a4ce37-acdc-4fb2-81be-cb8541c38956}
GLOBAL=MERC_IMPORT_PROCEDURE_ID
py() { python3 -I -c "$@"; }

draft=$(W call get "/api/v1/automations/$PROC/draft")
sha=$(py 'import json,sys;print(json.loads(sys.argv[1])["commit_sha"])' "$draft")
body=$(py 'import json,sys;print(json.dumps({"graph":json.load(open(sys.argv[1])),"expected_commit_sha":sys.argv[2],"commit_message":"sync from Merc monorepo procedures/import-pipeline"}))' "$HERE/automation.json" "$sha")
res=$(W call post "/api/v1/automations/$PROC/draft/commit" --data "$body")
py 'import json,sys;d=json.loads(sys.argv[1]);print("draft", d.get("commit_sha"), "valid:", (d.get("validation_result") or {}).get("valid"))' "$res"
W call post "/api/v1/automations/$PROC/draft/validate" --data '{}'; echo
[ "${1:-}" = --publish ] || exit 0
draft=$(W call get "/api/v1/automations/$PROC/draft")
pub=$(py 'import json,sys;d=json.loads(sys.argv[1]);print(json.dumps({"expected_variant_commit_sha":d["variant_commit_sha"],"expected_draft_commit_sha":d["commit_sha"],"commit_message":"Publish merc-import-pipeline"}))' "$draft")
W call post "/api/v1/automations/$PROC/draft/publish" --data "$pub" | head -c 400; echo
existing=$(W global-variables list 2>/dev/null | awk -v g="$GLOBAL" '$1==g {print $NF}')
if [ -n "$existing" ]; then W global-variables update "$existing" --value "\"$PROC\"" >/dev/null && echo "updated $GLOBAL=$PROC"
else W global-variables create --name "$GLOBAL" --type string --value "\"$PROC\"" --description "WP-IMP-01: merc-import-pipeline procedure id (fn:import-start invokes it)" >/dev/null && echo "created $GLOBAL=$PROC"; fi
