#!/usr/bin/env bash
# WP-APP-08 smoke principal: point ONE seed app_user row at the platform user running the smoke and give that user
# the matching app role, so the app runs with real rep / manager role permissions. Always restore afterwards.
#   principal.sh map <nikos|eleni> <rep|manager>     principal.sh restore
set -euo pipefail
W(){ wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464 "$@"; }
ME=d2835589-5502-4f71-a803-5cba4bb9bed6; LOG="$(dirname "$0")/principal-mapping.log"
row(){ case "$1" in nikos) echo d72bccf8-f36c-5abf-8d0d-142783f090cd;; eleni) echo fa4c7746-c253-5104-a735-7060bfddb756;; *) exit 2;; esac; }
set_wuid(){ echo "{\"data\":{\"wonderful_user_id\":\"$2\"}}" > /tmp/wpapp08-wuid.json
  W call put "/api/v1/custom-tables/merc.app_user/rows/$1" --data-file /tmp/wpapp08-wuid.json >/dev/null; }
case "$1" in
  map) set_wuid "$(row "$2")" "$ME"; W apps access-set-roles merc --user "$ME" --role "$3" >/dev/null
       echo "$(date -u +%FT%TZ) mapped $2 ($(row "$2" | cut -c1-8)) wonderful_user_id -> ${ME:0:8}, app role $3 (temporary)" | tee -a "$LOG" ;;
  restore) for k in nikos eleni; do set_wuid "$(row "$k")" "merc-demo-wuid-$k"; done
       W apps access-set-roles merc --user "$ME" >/dev/null
       echo "$(date -u +%FT%TZ) restored nikos/eleni wonderful_user_id=merc-demo-wuid-<key>; app roles reset to default" | tee -a "$LOG" ;;
esac
