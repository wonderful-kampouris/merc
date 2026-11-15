# WP-PLN-01 · Weekly visit planner, plan get/accept, visit updates, manager assignment

```yaml
id: WP-PLN-01
title: Weekly visit planner, plan get/accept, visit updates, manager assignment
wave: 2
priority: P0
requirements: [REQ-PLN-001, REQ-PLN-002, REQ-PLN-003, REQ-PLN-004]
freeze: in
owns: [shared/handlers/src/visit-plan-suggest.ts, shared/handlers/test/visit-plan-suggest.test.ts, functions/visit-plan-suggest/**, shared/handlers/src/visit-plan-get.ts, shared/handlers/test/visit-plan-get.test.ts, functions/visit-plan-get/**, shared/handlers/src/visit-plan-accept.ts, shared/handlers/test/visit-plan-accept.test.ts, functions/visit-plan-accept/**, shared/handlers/src/visit-update.ts, shared/handlers/test/visit-update.test.ts, functions/visit-update/**, shared/handlers/src/visit-assign.ts, shared/handlers/test/visit-assign.test.ts, functions/visit-assign/**, shared/handlers/src/task-assign.ts, shared/handlers/test/task-assign.test.ts, functions/task-assign/**]
depends_on: [WP-QA-01b, WP-CORE-01b, WP-INF-03, WP-OPS-01b, WP-CORE-03, WP-LIVE-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
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
