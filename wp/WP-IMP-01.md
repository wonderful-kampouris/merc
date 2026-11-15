# WP-IMP-01 · AI import functions + import-pipeline procedure

```yaml
id: WP-IMP-01
title: AI import functions + import-pipeline procedure
wave: 3
priority: P1
requirements: [REQ-IMP-001, REQ-IMP-002, REQ-IMP-003]
freeze: cut: import
owns: [shared/handlers/src/import-start.ts, shared/handlers/test/import-start.test.ts, functions/import-start/**, shared/handlers/src/import-get.ts, shared/handlers/test/import-get.test.ts, functions/import-get/**, shared/handlers/src/import-confirm.ts, shared/handlers/test/import-confirm.test.ts, functions/import-confirm/**, shared/handlers/src/import-analyze.ts, shared/handlers/test/import-analyze.test.ts, functions/import-analyze/**, shared/handlers/src/import-apply.ts, shared/handlers/test/import-apply.test.ts, functions/import-apply/**, procedures/import-pipeline/**]
depends_on: [WP-CORE-03, WP-LIVE-01, WP-CRM-01, WP-CRM-02, WP-DEB-01, WP-DEB-02, WP-APR-01, WP-DSC-01, WP-CRD-01, WP-CRD-02, WP-BRF-01, WP-ALR-01, WP-PLN-01, WP-PRS-01]
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
