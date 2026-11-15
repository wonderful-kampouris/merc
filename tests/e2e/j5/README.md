# J5 end to end (WP-E2E-05)

`pnpm test` here runs the J5 meeting loop (SPEC J5) through the real shared handlers: the brief 30 minutes before Café Miltos, "Call me", the post-visit prompt, the spoken debrief, the WhatsApp confirmation, "Fix" and "Brief did not help". It uses the seeded in-memory tables and a fixed clock (demo day 2026-11-16, visit at 12:45 Athens).

- `j5.ts` is the script. Crons run as the system principal, and the rep's taps and calls are the merc-buddy tool calls (`runAsTool` with a signed Merc claim). WhatsApp, outbound calls and the LLM extraction are injected fakes, so nothing leaves the process.
- `j5.test.ts` checks:
  - the run twice from a fresh seed, with the two runs identical;
  - the control run (no "Brief did not help" means the next brief still pushes Espresso Nuovo);
  - the dev-today run (no `MERC_WHATSAPP_CONNECTION`), where sends are recorded `failed` / `whatsapp_not_configured` and nothing throws.

No dev run is scripted: on dev, `MERC_CHANNELS_LIVE=true` and Nikos has a real phone.

## Real-phone run (human, in this order)

You need all of these first:
- WhatsApp connected, global `MERC_WHATSAPP_CONNECTION` set, and the merc-ops relay (`MERC_OPS_WHATSAPP_URL` + secret `MERC_OPS_WHATSAPP_HOOK`);
- the service account pinned for `/v1/agents/outbound`;
- crons `postvisit-prompts-due` and `debrief-confirm-due` deployed;
- the phone owner's consent.

```
W(){ wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464 "$@"; }
VISIT=dd6c531d-1412-5df9-8f6e-5df01556c7a8   # Café Miltos, today
```

1. Move the visit to 35 minutes from now:
   `W tables row-update merc.visit $VISIT --set planned_start_at=$(date -u -v+35M +%Y-%m-%dT%H:%M:00Z) --set status=planned`
2. Within 10 minutes, the previsit cron (every 5 min) sends one WhatsApp brief to the phone. Check it with `W tables row-list merc.visit_brief --json`: you should see status `sent`, push Espresso Nuovo and avoid Frappé Instant.
3. Tap **Call me** on the brief. The phone rings in under 30 s and the buddy reads the brief.
4. Move the visit end into the past: `--set planned_start_at=<now - 41 min>`. At the next 5-minute tick you get one "How did it go at Café Miltos?".
5. Tap **Call me** on it and say the debrief: "Ήμουν στο Café Miltos. Ο μύλος κάνει ακόμα θόρυβο… Βάλε μια παραγγελία για τα συνηθισμένα δώδεκα κιλά Espresso Classico."
6. Within 60 s, the WhatsApp summary arrives with the buttons Correct, Fix and Brief did not help. Its bullets should match the result card in the app.
7. Tap **Fix** and say "Ήταν 10 κιλά, όχι 12." Check that `merc.rep_feedback` has `debrief_corrected` with those words and that the order line is 10.
8. Tap **Brief did not help**. Check that `merc.rep_feedback` has `brief_not_useful` with the Nuovo product id.
9. Reset: undo the debrief actions (`undo_action`, or `scripts/demo-agent-crm.sh undo` style), then put the visit back:
   `--set planned_start_at=<original> --set status=planned`.
   Then delete the run's `rep_feedback`, `debrief_confirmation`, `visit_brief` and `buddy_call` rows (`W tables row-delete merc.<table> <id>`). A `brief_not_useful` row left behind stops the next Miltos brief from pushing Espresso Nuovo for 30 days.
