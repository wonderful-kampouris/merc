# WP-BUD-03 · merc-buddy phone + WhatsApp channels: inbound Merc number, outbound call/WhatsApp to the rep, channel-number identity, call_me_back

```yaml
id: WP-BUD-03
title: merc-buddy phone + WhatsApp channels: inbound Merc number, outbound call/WhatsApp to the rep, channel-number identity, call_me_back
wave: 4
priority: P0
requirements: [REQ-BUD-012, REQ-BUD-013, REQ-BUD-014, REQ-BUD-015, REQ-BUD-016]
freeze: in
owns: [shared/handlers/src/buddy-call-start.ts, shared/handlers/test/buddy-call-start.test.ts, functions/buddy-call-start/**, shared/handlers/src/buddy-call-outcome.ts, shared/handlers/test/buddy-call-outcome.test.ts, functions/buddy-call-outcome/**, shared/handlers/src/buddy-callbacks-due.ts, shared/handlers/test/buddy-callbacks-due.test.ts, functions/buddy-callbacks-due/**, agents/merc-buddy/tools/call_me_back*, agents/merc-buddy/tools/report_buddy_call_outcome*, agents/merc-buddy/skills/reach_me/**, agents/merc-buddy/evals/channels/**, docs/guides/telephony-whatsapp.md]
depends_on: [WP-BUD-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - apply table buddy_call and the new app_user columns (phone_channel_enabled, notify_channel, whatsapp_window_until) on dev with infra/tables
  - shared/core channel-number identity (me.ts callerFromTool -> channel_number) used unchanged; unit tests for inbound, outbound, WhatsApp, unknown and duplicate numbers
  - merc-buddy prompt gets the channel_rules from contracts/agents/merc-buddy.json; triggers OnVoicemailDetected/OnEnd wired to report_buddy_call_outcome
  - evals: phone-style short answers, unknown-number refusal, 'call me at 5' -> call_me_back with the right time
  - live: if MERC_BUDDY_NUMBER is set, place ONE outbound test call to the team test phone only; otherwise stop at the request body and record it in evidence
  - WhatsApp: if the number is attached to merc-buddy, send one template to the team test phone; otherwise record what is missing in human_steps
  - purposes pre_visit, post_visit and debrief_confirm supported (REQ-MTG-001/005/006): WhatsApp template or interactive free-form inside the 24 h window, with the quick replies from the platform contract
  - handler impl in shared/handlers/src/<slug>.ts runs through @merc/core runFunction; thin wrapper functions/<slug>/ (defineFunction) deployable by infra/deploy
  - unit tests per handler on the in-memory table fake with seed data; contract tests: request/response validate against spec/contracts/functions/<slug>.json
  - deployed to dev and attached to app merc (app-callable ones); smoke call on dev seed data meets each listed REQ acceptance (or the exact blocker is reported)
status: building
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
