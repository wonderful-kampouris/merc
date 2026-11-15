# Promotion runbook: dev to the demo workspace (WP-DEMO-01, REQ-OPS-001)

The demo runs in the **demo** environment of `infra/deploy/environments.json`. On 2026-11-15 the team chose the Team Delta workspace, `6f6d70c8-…`. Only a human promotes. Builders and agents never deploy to demo.

The full, ordered command list is generated offline:

```
node --experimental-strip-types infra/demo/src/promote-plan.ts --env demo --out docs/demo/promotion-dry-run.txt
```

The script reads `infra/demo/promotion.json` (everything J5 needs) and runs `deploy.sh <component> --env demo --print-plan` for each component. That flag exits before git or the network. The last output is in [`promotion-dry-run.txt`](promotion-dry-run.txt). It prints `gate: BLOCKED` and exits 1 when the demo env is empty or equals dev.

## Before you start (gate)

- [ ] `environments.json` → `demo` holds the workspace you mean, and you typed `ENV=demo` yourself. `make` ignores an exported `ENV`.
- [ ] `bash scripts/check.sh` is green, and the merc-buddy evals pass on dev (REQ-OPS-004). A failing eval blocks promotion.
- [ ] Nobody else is deploying to demo right now. Pushes to the shared `functions.git` race: on a rejected push, fetch, rebase and retry. Never force-push.
- [ ] The phone owner has agreed to live WhatsApp messages and calls during rehearsal and on stage.

## Order (why it is this order)

| # | Step | Command (from the dry run) | Notes |
|---|---|---|---|
| 1 | Tables | `infra/tables/apply.sh --workspace <demo> --dry-run`, then without `--dry-run`, then `verify.sh` | Schema `merc` from the contracts. DRIFT exits 1 and is never applied. |
| 2 | Seed | `infra/demo/reset-demo.sh --env demo --wuid-file infra/seed/wuid.demo.json` (`--dry-run` first) | `wuid.demo.json` maps the demo users to **demo-workspace** Wonderful user ids (copy `wuid.example.json`). `phones.json` gives Nikos the real phone. Leave it out to keep every seed phone fake. |
| 3 | Globals and secrets | `wful … global-variables create …`, `wful … secrets create …` | `MERC_BUDDY_NUMBER`, `MERC_WHATSAPP_CONNECTION`, `MERC_CHANNELS_LIVE` (false until consent). Secret values come from a private file and never go into the repo (REQ-OPS-005). |
| 4 | Service account | Admin: pin `merc-platform-api` (agents:edit, communications:edit) on the call/WhatsApp functions and crons | Without it, "Call me" is recorded `failed / no_service_account`. |
| 5 | Knowledge bases | `infra/kb/apply.sh --env demo --plan`, then without `--plan` | `merc-catalog`, `merc-playbook` and `merc-company`. The brief words its "why" from `merc-company`. |
| 6 | Functions, crons, agent, app | `make plan C=<c> ENV=demo`, then `make deploy C=<c> ENV=demo` for each of the 29 components | Backend first, then the `merc-buddy` agent (its tools call the functions), then the app. |
| 7 | Monitors | `node --experimental-strip-types infra/monitors/src/apply.ts --env demo` (plan), then `--push` | Debrief latency, confirm latency, missed brief. |
| 8 | Rehearsal | `infra/demo/reset-demo.sh --env demo --next-visit-in 32 --live-phone-ok`, then [`demo-script.md`](demo-script.md) | Record the fallback video in this run ([`fallback-video.md`](fallback-video.md)). |

## Smoke after promotion (read-only)

```
W(){ wful --profile hackathon --workspace <demo> "$@"; }
infra/seed/check.sh --workspace <demo> --profile hackathon --demo-day $(TZ=Europe/Athens date +%F)
W functions cron list        # previsit-briefs-due, postvisit-prompts-due, debrief-confirm-due, buddy-callbacks-due enabled
W tables row-list merc.visit_brief --json   # empty before the rehearsal
```

## Roll back

Each deploy is one git commit in the platform repo. To undo a component, re-run `make deploy C=<c> ENV=demo` from the previous monorepo commit. Data: `reset-demo.sh --env demo` brings the seed back. It never deletes non-seed rows outside Café Miltos.
