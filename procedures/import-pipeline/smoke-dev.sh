#!/usr/bin/env bash
# Dev smoke for WP-IMP-01 (REQ-IMP-001..003). Uploads a fixture to Custom Storage, creates a data_import row for the
# seeded admin (Thanasis), runs the import-pipeline procedure (draft test run by default), and prints the results.
#   procedures/import-pipeline/smoke-dev.sh start <accounts|orders> [baseline]   -> prints IMPORT=<id> RUN=<id>
#   procedures/import-pipeline/smoke-dev.sh confirm <import_id>                   -> status confirmed (the wait step resumes)
#   procedures/import-pipeline/smoke-dev.sh show <import_id>                      -> import row, mapping, issues
#   procedures/import-pipeline/smoke-dev.sh cleanup <import_id>                   -> deletes what the smoke created
# Dev workspace only. Never run against another workspace.
set -euo pipefail
WS=7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464
W() { wful --profile hackathon --workspace "$WS" "$@"; }
HERE="$(cd "$(dirname "$0")" && pwd)"
PROC=${MERC_IMPORT_PROCEDURE_ID:-20a4ce37-acdc-4fb2-81be-cb8541c38956}
ORG=97ee94d2-794c-5d47-923d-5616221c9835
ADMIN=bcc2830f-a618-5ab1-bb5c-46707c21a9e6
py() { python3 -I -c "$@"; }

upload() { # key file content-type
  local key=$1 file=$2 ct=$3 size; size=$(wc -c <"$file" | tr -d ' ')
  local res; res=$(W call post /api/v1/custom-storage/upload-url --data "{\"key\":\"$key\",\"content_type\":\"$ct\",\"size\":$size}")
  local url; url=$(py 'import json,sys;print(json.loads(sys.argv[1])["upload_url"])' "$res")
  local hdrs; hdrs=$(py 'import json,sys;h=json.loads(sys.argv[1]).get("upload_headers") or {};print("\n".join(f"{k}: {v}" for k,v in h.items()))' "$res")
  local args=(-sS -f -X PUT -H "Content-Type: $ct" --data-binary "@$file")
  while IFS= read -r h; do [ -n "$h" ] && args+=(-H "$h"); done <<<"$hdrs"
  curl "${args[@]}" "$url" >/dev/null
  W call post "/api/v1/custom-storage/upload-complete?key=$(py 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$key")" >/dev/null
}

case "${1:-}" in
  start)
    kind=${2:-accounts}; baseline=false; [ "${3:-}" = baseline ] && baseline=true
    if [ "$kind" = orders ]; then file="$HERE/fixtures/baseline-orders.csv"; else file="$HERE/fixtures/messy-accounts-200.csv"; fi
    row=$(W tables row-insert merc.data_import --data "{\"org_id\":\"$ORG\",\"uploaded_by\":\"$ADMIN\",\"data_type\":\"$kind\",\"status\":\"uploaded\",\"is_baseline\":$baseline}" --json)
    id=$(py 'import json,sys;d=json.loads(sys.argv[1]);print(d.get("id") or d["data"]["id"])' "$row")
    key="merc/imports/$id/$(basename "$file")"
    upload "$key" "$file" text/csv
    W tables row-update merc.data_import "$id" --data "{\"file_ref\":\"$key\"}" >/dev/null
    run=$(W call post "/api/v1/automations/$PROC/draft/test-runs" --data "{\"trigger\":{\"import_id\":\"$id\"}}")
    echo "IMPORT=$id KEY=$key"
    echo "RUN=$(py 'import json,sys;d=json.loads(sys.argv[1]);print(d.get("run_id") or d.get("id") or d)' "$run")"
    ;;
  confirm)
    W tables row-update merc.data_import "$2" --data "{\"status\":\"confirmed\",\"confirmed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >/dev/null
    echo "confirmed $2"
    ;;
  show)
    W tables row-get merc.data_import "$2" --json | py 'import json,sys;d=json.load(sys.stdin);print(json.dumps(d.get("data",d),ensure_ascii=False))'
    W tables row-list merc.import_column_mapping --filters-json "{\"filters\":[{\"key\":\"import_id\",\"operator\":\"eq\",\"value\":\"$2\"}]}" --limit 50 --json | py '
import json,sys
d=json.load(sys.stdin); rows=d.get("rows") or d.get("data") or []
for r in rows: x=r.get("data",r); print("map", x["source_column"], "->", x.get("target_field"), x.get("confidence"), "confirmed" if x["confirmed"] else "ASK")'
    W tables row-list merc.import_row_issue --filters-json "{\"filters\":[{\"key\":\"import_id\",\"operator\":\"eq\",\"value\":\"$2\"}]}" --limit 100 --sort "row_no asc" --json | py '
import json,sys
d=json.load(sys.stdin); rows=d.get("rows") or d.get("data") or []
for r in rows: x=r.get("data",r); print("issue row", int(x["row_no"]), x["issue_type"], "-", x.get("detail"))'
    ;;
  cleanup)
    id=$2
    # orders/lines created by this import (external_ref import:<id>:...)
    W tables row-list merc.sales_order --filters-json "{\"filters\":[{\"key\":\"external_ref\",\"operator\":\"starts_with\",\"value\":\"import:$id:\"}]}" --limit 200 --json | py '
import json,sys
d=json.load(sys.stdin); rows=d.get("rows") or d.get("data") or []
print("\n".join(r["id"] for r in rows))' | while read -r oid; do
      [ -z "$oid" ] && continue
      W tables row-list merc.order_line --filters-json "{\"filters\":[{\"key\":\"order_id\",\"operator\":\"eq\",\"value\":\"$oid\"}]}" --limit 50 --json | py '
import json,sys
d=json.load(sys.stdin); rows=d.get("rows") or d.get("data") or []
print("\n".join(r["id"] for r in rows))' | while read -r lid; do [ -n "$lid" ] && W tables row-delete merc.order_line "$lid" --force >/dev/null; done
      W tables row-delete merc.sales_order "$oid" --force >/dev/null && echo "deleted order $oid"
    done
    key=$(W tables row-get merc.data_import "$id" --json | py 'import json,sys;d=json.load(sys.stdin);print((d.get("data",d)).get("file_ref") or "")')
    W tables row-delete merc.data_import "$id" --force >/dev/null && echo "deleted data_import $id (mapping + issues cascade)"
    [ -n "$key" ] && W call delete "/api/v1/custom-storage/object?key=$(py 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$key")" >/dev/null && echo "deleted file $key"
    ;;
  *) sed -n 2,8p "$0"; exit 2 ;;
esac
