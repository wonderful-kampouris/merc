# WP-BRF-01 · Briefing generation and read, today, end of day

```yaml
id: WP-BRF-01
title: Briefing generation and read, today, end of day
wave: 2
priority: P0
requirements: [REQ-BRF-001, REQ-BRF-002, REQ-BRF-003, REQ-BUD-010]
freeze: in
owns: [shared/handlers/src/briefing-generate.ts, shared/handlers/test/briefing-generate.test.ts, functions/briefing-generate/**, shared/handlers/src/briefing-get.ts, shared/handlers/test/briefing-get.test.ts, functions/briefing-get/**, shared/handlers/src/today-get.ts, shared/handlers/test/today-get.test.ts, functions/today-get/**, shared/handlers/src/eod-summary.ts, shared/handlers/test/eod-summary.test.ts, functions/eod-summary/**]
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
