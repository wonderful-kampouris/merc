# WP-SET-01 · Settings, users, territories, transfers, GDPR, usage

```yaml
id: WP-SET-01
title: Settings, users, territories, transfers, GDPR, usage
wave: 3
priority: P1
requirements: [REQ-SET-001, REQ-SET-002, REQ-SET-003, REQ-SET-004, REQ-SET-005, REQ-CORE-010]
freeze: in
owns: [shared/handlers/src/settings-get.ts, shared/handlers/test/settings-get.test.ts, functions/settings-get/**, shared/handlers/src/settings-update.ts, shared/handlers/test/settings-update.test.ts, functions/settings-update/**, shared/handlers/src/users-list.ts, shared/handlers/test/users-list.test.ts, functions/users-list/**, shared/handlers/src/user-upsert.ts, shared/handlers/test/user-upsert.test.ts, functions/user-upsert/**, shared/handlers/src/territories-list.ts, shared/handlers/test/territories-list.test.ts, functions/territories-list/**, shared/handlers/src/territory-upsert.ts, shared/handlers/test/territory-upsert.test.ts, functions/territory-upsert/**, shared/handlers/src/assignments-transfer.ts, shared/handlers/test/assignments-transfer.test.ts, functions/assignments-transfer/**, shared/handlers/src/contact-export.ts, shared/handlers/test/contact-export.test.ts, functions/contact-export/**, shared/handlers/src/contact-erase.ts, shared/handlers/test/contact-erase.test.ts, functions/contact-erase/**, shared/handlers/src/usage-flush.ts, shared/handlers/test/usage-flush.test.ts, functions/usage-flush/**]
depends_on: [WP-CORE-03, WP-LIVE-01, WP-CRM-01, WP-CRM-02, WP-DEB-01, WP-DEB-02, WP-APR-01, WP-CRD-01, WP-CRD-02, WP-BRF-01, WP-ALR-01, WP-PLN-01]
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
