#!/usr/bin/env bash
# Test double for wful (functions api list/create/clone, agents clone). State: $FAKE_WFUL_STATE/functions.txt (one "slug METHOD" per line), bare repo at $FAKE_WFUL_REPO.
set -euo pipefail
while [ "${1:-}" = --profile ] || [ "${1:-}" = --workspace ] || [ "${1:-}" = --no-interactive ]; do
  [ "$1" = --no-interactive ] && shift || shift 2; done
echo "$*" >> "$FAKE_WFUL_STATE/calls.log"
arg() { local k="$1"; shift; while [ $# -gt 0 ]; do [ "$1" = "$k" ] && { echo "$2"; return; }; shift; done; }
case "$1 $2 $3" in
  "functions api list")
    python3 -I -c 'import json,sys
rows=[l.split() for l in open(sys.argv[1]) if l.strip()]
print(json.dumps([{"path_slug":s,"method":m} for s,m in rows]))' "$FAKE_WFUL_STATE/functions.txt" ;;
  "functions api create")
    echo "$(arg --slug "$@") $(arg --method "$@")" >> "$FAKE_WFUL_STATE/functions.txt"
    git clone -q "$FAKE_WFUL_REPO" "$(arg --dir "$@")" ;;
  "functions api clone") git clone -q "$FAKE_WFUL_REPO" "$(arg --dir "$@")" ;;
  "agents clone --agent")
    [ -n "${FAKE_WFUL_AGENT_REPO:-}" ] || { echo "agent not found" >&2; exit 1; }
    git clone -q "$FAKE_WFUL_AGENT_REPO" "$(arg --dir "$@")" ;;
  *) echo "fake-wful: unsupported: $*" >&2; exit 2 ;;
esac
