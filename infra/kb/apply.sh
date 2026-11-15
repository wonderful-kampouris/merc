#!/usr/bin/env bash
# infra/kb/apply.sh — create or refresh the Context Hub knowledge bases merc-catalog and merc-playbook (WP-CRD-01).
#   infra/kb/apply.sh [--env dev] [--plan]
# Idempotent: finds each KB by name (creates it with pipeline.json if missing), uploads the files of
# content/kb/<kb>/ that are not there yet (same name = already uploaded; re-upload by deleting the file in the UI or
# with `wful kb file-delete`), commits the evals, publishes, runs the pipeline with --wait and smoke-asks it.
# Only touches knowledge bases named merc-catalog / merc-playbook. Never deletes anything.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_NAME=dev; PLAN=0
while [ $# -gt 0 ]; do case "$1" in --env) ENV_NAME="$2"; shift 2;; --plan) PLAN=1; shift;; *) echo "unknown arg $1" >&2; exit 2;; esac; done
read -r PROFILE WORKSPACE < <(python3 -I -c 'import json,sys
e=json.load(open(sys.argv[1]))[sys.argv[2]]; print(e["profile"], e["workspace"])' "$ROOT/infra/deploy/environments.json" "$ENV_NAME")
W(){ wful --profile "$PROFILE" --workspace "$WORKSPACE" "$@"; }
die(){ echo "kb: $*" >&2; exit 1; }

kb_id(){ W kb list --json | python3 -I -c 'import json,sys
d=json.load(sys.stdin); d=d.get("data",d) if isinstance(d,dict) else d
print(next((k.get("id") for k in d if k.get("name")==sys.argv[1]),""))' "$1"; }

question(){ case "$1" in merc-catalog) echo "Why does Espresso Nuovo fit a specialty café?";; *) echo "The owner is happy with BlueBean Roasters. How do I answer?";; esac; }
for KB in merc-catalog merc-playbook; do
  SRC="$ROOT/content/kb/$KB"; [ -d "$SRC" ] || die "no content folder $SRC"
  ID="$(kb_id "$KB")"
  if [ -z "$ID" ]; then
    if [ "$PLAN" = 1 ]; then echo "$KB: missing, would create"; continue; fi
    DESC="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["knowledge_bases"][sys.argv[2]]["content"])' "$ROOT/spec/contracts/platform/platform.json" "$KB")"
    W kb create --name "$KB" --description "Merc: $DESC" --definition-file "$ROOT/infra/kb/pipeline.json" >/dev/null || die "create $KB failed"
    ID="$(kb_id "$KB")"; [ -n "$ID" ] || die "$KB created but not listed"
    echo "$KB: created $ID"
  else echo "$KB: exists $ID"; fi
  HAVE="$(W kb file-list "$ID" --step upload-1 --json | python3 -I -c 'import json,sys
d=json.load(sys.stdin); d=d.get("data",d) if isinstance(d,dict) else d
print("\n".join(f.get("name","") for f in (d or [])))')"
  NEW=(); for f in "$SRC"/*.md; do grep -qxF "$(basename "$f")" <<<"$HAVE" || NEW+=(--file "$f"); done
  if [ "$PLAN" = 1 ]; then echo "$KB: would upload $(( ${#NEW[@]} / 2 )) file(s)"; continue; fi
  [ ${#NEW[@]} -gt 0 ] && { W kb file-upload "$ID" --step upload-1 "${NEW[@]}" >/dev/null || die "upload to $KB failed"; echo "$KB: uploaded $(( ${#NEW[@]} / 2 )) file(s)"; }
  W kb draft-commit "$ID" --definition-file "$ROOT/infra/kb/pipeline.json" --evals-file "$ROOT/infra/kb/evals.$KB.json" --message "WP-CRD-01 evals" >/dev/null || die "draft-commit $KB failed"
  W kb draft-publish "$ID" >/dev/null 2>&1 || echo "$KB: nothing to publish (draft equals published)"
  W kb run "$ID" --wait >/dev/null || die "run $KB did not succeed (wful kb run-list $ID --status failed)"
  echo "$KB: run succeeded"
  W kb ask "$ID" "$(question "$KB")" --top-k 2 --source test | head -12
done
