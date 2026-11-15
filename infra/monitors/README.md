# infra/monitors (WP-QA-02, REQ-OPS-003)

One platform monitor per entry in `spec/contracts/platform/platform.json#monitors`, named `merc-<key>`.

| monitor | how it is measured | fires when |
|---|---|---|
| `merc-function-errors` | native `ApiFunctionFailure` (every API function in the workspace) | more than 5 failed runs in 15 min. The platform has a failure count for functions, not a rate. |
| `merc-debrief-latency` | cron `merc-watch-debrief-latency` (every 5 min) reads `voice_log.processing_ms` | p95 > 20 s over 15 min |
| `merc-voice-log-failures` | cron `merc-watch-voice-log-failures` (15 min) | more than 3 `voice_log.status=failed` in 1 h |
| `merc-approval-sla-breach` | cron `merc-watch-approval-sla-breach` (hourly) | any approval `escalated` in 24 h (info) |
| `merc-message-send-failures` | cron `merc-watch-message-send-failures` (15 min) | any failed `customer_message` approval in 1 h |
| `merc-previsit-brief-missed` | cron `merc-watch-previsit-brief-missed` (hourly) | a planned visit started with no brief sent/called before it (REQ-MTG-001) |
| `merc-debrief-confirm-latency` | cron `merc-watch-debrief-confirm-latency` (15 min) | p95 of `debrief_confirmation.sent_at - voice_log.processed_at` > 60 s over 1 h (REQ-MTG-006) |

Native monitor metrics cannot read Merc tables. So each table-derived measure is a small cron that **fails its run
on a breach**. A `CronFunctionFailure` monitor scoped to that cron (window = 2 cron periods) then opens the incident.
The crons only read tables. They log the key, numbers and row ids, never names, phones or emails (REQ-NFR-005).

## Commands
```
pnpm --dir infra/monitors test                                              # unit tests (watches, bodies, bundle freshness)
pnpm --dir infra/monitors build                                             # regenerate out/functions/merc-watch-*/
node --experimental-strip-types infra/monitors/src/apply.ts --env dev           # plan
node --experimental-strip-types infra/monitors/src/apply.ts --env dev --push    # deploy crons + create/update monitors + verify
```
`apply.ts` deploys each cron to its **own** function repo (`wful functions cron create --dedicated-repo`, then
clone, replace `functions/<slug>/`, secret-scan, commit, push). It does not use the shared `functions.git` through
`infra/deploy/deploy.sh`: on 2026-11-15 every push to that repo timed out (HTTP 524), while dedicated repos push in
seconds. It matches monitors by name, so re-running updates them and never duplicates them. It never deletes anything.
Recipient: `--recipient <email>`, or by default the signed-in wful user's address as kind `email`. Kind
`user_email` returned HTTP 500 on create. The platform refuses a monitor with no recipient unless a routing
default exists for its severity.

## Fire drill: "the debrief latency monitor fires on an injected slow run"
The cron accepts synthetic rows **only from its schedule params**, which only the deployer can set. Nothing is
written to a table, and injected ids are forced to `synthetic-*`:
```
W(){ wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464 "$@"; }
# optional: keep the drill silent. A breach outside the active schedule still opens an incident ("Outside active
# hours") but sends no email. Set active_schedule to [{"week_day":"Monday","start_time":"03:00:00","end_time":"03:01:00"}]
W alerts monitor-update <merc-debrief-latency id> --value-file quiet.json
W functions cron update merc-watch-debrief-latency --data '{"cron_schedules":[{"cron_expression":"*/5 * * * *","timezone":"Europe/Athens","enabled":true,"params":{"inject_rows":{"voice_log":[{"processing_ms":45000}]}}}]}'
# within 5 min: the run fails with "MERC_MONITOR_BREACH debrief-latency: 45000 ms > 20000 (samples 1, ids synthetic-1)"
W alerts incident-list            # an open incident on merc-debrief-latency
W functions cron update merc-watch-debrief-latency --data '{"cron_schedules":[{"cron_expression":"*/5 * * * *","timezone":"Europe/Athens","enabled":true,"params":{}}]}'
# and set active_schedule back to [] (always on)
```

## Runbook
- **function-errors**: the notification lists the failing functions. Open the function's runs in the platform. A
  `blocked` error means a human step is missing (a secret or a connection). `upstream_failed` means a platform or LLM failure.
- **debrief-latency**: look at `voice_log.processing_ms` of the ids in the breach message. Slow runs come from the
  `merc-extract` model profile. Check the provider status and the debrief eval `p95_ms`.
- **voice-log-failures**: read `voice_log.error` of the failed rows. Re-run them from the app (the audio is kept).
- **approval-sla-breach**: info only. A manager left a request past its SLA, and `approvals-expire` escalated it.
- **message-send-failures**: a customer message approved in Merc failed to send. Check the Gmail connection
  (`merc-gmail`) and the governance approvals (policy `merc-external-send-approval`).
- **previsit-brief-missed**: `previsit-briefs-due` did not send a brief before a planned visit started. Check that
  cron's runs, `MERC_WHATSAPP_CONNECTION` (absent means `failed/whatsapp_not_configured`) and the rep's channel settings.
- **debrief-confirm-latency**: `debrief-confirm-due` is late. Check its runs and the WhatsApp connection.
