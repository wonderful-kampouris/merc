#!/usr/bin/env bash
# End-to-end proof that the agent fills the CRM: chat with merc-buddy-pro (Team Delta) as the demo rep, log a
# Café Miltos debrief, correct it, and print what landed in the merc tables. No calls or WhatsApp messages are sent.
#   scripts/demo-agent-crm.sh          run debrief + fix, print the CRM rows
#   scripts/demo-agent-crm.sh undo     undo every applied action of the debriefs this script logged (demo reset)
set -euo pipefail
WS=6f6d70c8-6864-40f6-8b70-19ddf8b8923c; AGENT=merc-buddy-pro; MILTOS=59b5e454-cc4b-5fab-939b-a50c78e8aa9b
W(){ wful --profile hackathon --workspace "$WS" "$@"; }
OUT="${TMPDIR:-/tmp}/merc-demo-agent-crm"; mkdir -p "$OUT"
DEBRIEF="Log my Café Miltos visit: Miltos took 12 kilos of Nuovo, he liked it for the grinder. The grinder is still noisy, we are sending a technician on Thursday. Aroma offered him a better price, but he is not interested."
FIX="Fix: it was 10 kilos, not 12."

rows(){ W tables row-list "merc.$1" --limit "${2:-100}" --json; }

if [[ "${1:-}" == "undo" ]]; then
  vls=$(rows voice_log 50 | python3 -c 'import json,sys;d=json.load(sys.stdin);d=d.get("data",d)
print(" ".join(r.get("data",r)["id"] for r in d if "Miltos took 12 kilos" in (r.get("data",r).get("transcript") or "")))')
  ids=$(rows ai_action 200 | VLS="$vls" python3 -c 'import json,os,sys;d=json.load(sys.stdin);d=d.get("data",d);v=set(os.environ["VLS"].split())
print(" ".join(r.get("data",r)["id"] for r in d if r.get("data",r).get("voice_log_id") in v and r.get("data",r)["status"]=="applied"))')
  [[ -z "$ids" ]] && { echo "nothing to undo"; exit 0; }
  printf 'I need to undo things from my Café Miltos debriefs today, switch to the debrief skill.\nThose debriefs were tests. Call undo_action for each of these ai_action ids in this order, no questions: %s\n' "$ids" \
    | W agents chat "$AGENT" > "$OUT/undo.txt" 2>&1
  echo "undone: $(grep -c '"status":"undone"' "$OUT/undo.txt" || true) of $(wc -w <<<"$ids")"; exit 0
fi

printf '%s\n%s\n' "$DEBRIEF" "$FIX" | W agents chat "$AGENT" > "$OUT/chat.txt" 2>&1
echo "== conversation (full log: $OUT/chat.txt)"
grep -E '^(you|agent)>|^tool> (resolve_account|log_visit|record_feedback)' "$OUT/chat.txt" | cut -c1-220
echo; echo "== CRM rows for Café Miltos"
for t in activity task problem competitor_signal sales_order rep_feedback; do
  rows "$t" 30 | T="$t" M="$MILTOS" python3 -c 'import json,os,sys;d=json.load(sys.stdin);d=d.get("data",d)
t=os.environ["T"];rs=[r.get("data",r) for r in d]
rs=[r for r in rs if r.get("account_id")==os.environ["M"] or t=="rep_feedback"][:3]
for r in rs: print(f"{t:18}", " | ".join(str(r.get(k))[:60] for k in ("title","body","statement","description","status","kind","detail","order_date") if r.get(k) is not None))'
done
echo; echo "== AI actions (applied = live, undone = replaced by the fix)"
rows ai_action 14 | python3 -c 'import json,sys;d=json.load(sys.stdin);d=d.get("data",d)
for r in d[:14]: r=r.get("data",r); print("%-26s %-8s voice_log %s" % (r["action_type_code"], r["status"], str(r.get("voice_log_id"))[:8]))'
