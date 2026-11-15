# WP-CMP-01 · Campaigns: list, upsert, draft from text, funnel

```yaml
id: WP-CMP-01
title: Campaigns: list, upsert, draft from text, funnel
wave: 3
priority: P1
requirements: [REQ-CMP-001, REQ-CMP-002, REQ-CMP-003, REQ-DEB-008]
freeze: in
owns: [shared/handlers/src/campaigns-list.ts, shared/handlers/test/campaigns-list.test.ts, functions/campaigns-list/**, shared/handlers/src/campaign-upsert.ts, shared/handlers/test/campaign-upsert.test.ts, functions/campaign-upsert/**, shared/handlers/src/campaign-draft-from-text.ts, shared/handlers/test/campaign-draft-from-text.test.ts, functions/campaign-draft-from-text/**, shared/handlers/src/campaign-funnel.ts, shared/handlers/test/campaign-funnel.test.ts, functions/campaign-funnel/**]
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
