# WP-DEB-01 · Debrief: debrief-process + debrief-result-get + golden set evals/debrief

```yaml
id: WP-DEB-01
title: Debrief: debrief-process + debrief-result-get + golden set evals/debrief
wave: 2
priority: P0
requirements: [REQ-DEB-002, REQ-DEB-003, REQ-DEB-004, REQ-DEB-005, REQ-DEB-006, REQ-DEB-007, REQ-DEB-008, REQ-CORE-003, REQ-NFR-001, REQ-NFR-004]
freeze: in
owns: [shared/handlers/src/debrief-process.ts, shared/handlers/test/debrief-process.test.ts, functions/debrief-process/**, shared/handlers/src/debrief-result-get.ts, shared/handlers/test/debrief-result-get.test.ts, functions/debrief-result-get/**, evals/debrief/**]
depends_on: [WP-QA-01b, WP-CORE-01b, WP-INF-03, WP-OPS-01b, WP-CORE-03, WP-LIVE-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - golden set of >= 15 utterances (el, en, mixed, noise, half sentence, unknown customer, planted hallucinations); 100% no invented numbers; >= 80% field-level pass
  - note text and non-numeric fields (e.g. follow_up.channel) grounded: unsupported values dropped and asked
  - p95 < 20 s over 10 dev runs
  - handler impl in shared/handlers/src/<slug>.ts runs through @merc/core runFunction; thin wrapper functions/<slug>/ (defineFunction) deployable by infra/deploy
  - unit tests per handler on the in-memory table fake with seed data; contract tests: request/response validate against spec/contracts/functions/<slug>.json
  - deployed to dev and attached to app merc (app-callable ones); smoke call on dev seed data meets each listed REQ acceptance (or the exact blocker is reported)
status: done
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
