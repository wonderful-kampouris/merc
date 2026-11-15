# WP-DSC-01 · Discounts in 3 tiers: check, request (single outbound call), outcome, approver brief, decide, manager list, SLA watch

```yaml
id: WP-DSC-01
title: Discounts in 3 tiers: check, request (single outbound call), outcome, approver brief, decide, manager list, SLA watch
wave: 2
priority: P0
requirements: [REQ-DSC-001, REQ-DSC-002, REQ-DSC-003, REQ-DSC-004, REQ-DSC-005, REQ-DSC-006, REQ-DSC-007, REQ-DSC-009, REQ-APV-003]
freeze: cut: discounts
owns: [shared/handlers/src/discount-check.ts, shared/handlers/test/discount-check.test.ts, functions/discount-check/**, shared/handlers/src/discount-request.ts, shared/handlers/test/discount-request.test.ts, functions/discount-request/**, shared/handlers/src/manager-call-outcome.ts, shared/handlers/test/manager-call-outcome.test.ts, functions/manager-call-outcome/**, shared/handlers/src/approver-brief.ts, shared/handlers/test/approver-brief.test.ts, functions/approver-brief/**, shared/handlers/src/approval-decide.ts, shared/handlers/test/approval-decide.test.ts, functions/approval-decide/**, shared/handlers/src/manager-approvals-list.ts, shared/handlers/test/manager-approvals-list.test.ts, functions/manager-approvals-list/**, shared/handlers/src/approval-sla-watch.ts, shared/handlers/test/approval-sla-watch.test.ts, functions/approval-sla-watch/**]
depends_on: [WP-QA-01b, WP-CORE-01b, WP-INF-03, WP-OPS-01b, WP-CORE-03, WP-LIVE-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - live path degrades to async with a clear reason while no caller id / service account exists; never dials a non-team number
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
