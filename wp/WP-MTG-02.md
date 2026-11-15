# WP-MTG-02 · Meeting loop delivery: pre-visit trigger, post-visit prompt, WhatsApp debrief confirmation with Correct/Fix, feedback record + eval export, buddy meeting_loop skill

```yaml
id: WP-MTG-02
title: Meeting loop delivery: pre-visit trigger, post-visit prompt, WhatsApp debrief confirmation with Correct/Fix, feedback record + eval export, buddy meeting_loop skill
wave: 4
priority: P0
requirements: [REQ-MTG-001, REQ-MTG-004, REQ-MTG-005, REQ-MTG-006, REQ-MTG-007, REQ-MTG-008, REQ-MTG-009]
freeze: in
owns: [shared/handlers/src/previsit-briefs-due.ts, shared/handlers/test/previsit-briefs-due.test.ts, functions/previsit-briefs-due/**, shared/handlers/src/postvisit-prompts-due.ts, shared/handlers/test/postvisit-prompts-due.test.ts, functions/postvisit-prompts-due/**, shared/handlers/src/debrief-confirm-send.ts, shared/handlers/test/debrief-confirm-send.test.ts, functions/debrief-confirm-send/**, shared/handlers/src/debrief-confirm-due.ts, shared/handlers/test/debrief-confirm-due.test.ts, functions/debrief-confirm-due/**, shared/handlers/src/feedback-record.ts, shared/handlers/test/feedback-record.test.ts, functions/feedback-record/**, agents/merc-buddy/tools/get_visit_brief*, agents/merc-buddy/tools/send_debrief_confirmation*, agents/merc-buddy/tools/record_feedback*, agents/merc-buddy/skills/meeting_loop/**, agents/merc-buddy/evals/meeting_loop/**, evals/debrief/field/**]
depends_on: [WP-MTG-01, WP-BUD-03, WP-DEB-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - crons idempotent: re-running previsit-briefs-due / postvisit-prompts-due / debrief-confirm-due on the same state sends nothing new (unit tests with a fixed clock)
  - debrief confirmation bullets built in code from the voice log's ai_actions; sent within 60 s of completion on dev
  - merc-buddy gets the meeting_loop skill, 3 tools and the new channel_rules from contracts/agents/merc-buddy.json; evals: Call me -> call_me_back pre_visit, Correct, Fix with undo + log_visit + debrief_corrected, Not useful
  - feedback export: evals/debrief/field/export.py turns debrief_corrected rows into eval cases and sets exported_to_evals; one case per correction
  - live: messages and calls go only to the team test phone; without WhatsApp/number, stop at the request body and list the human steps
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
