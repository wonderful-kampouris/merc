# WP-DSH-01 · KPI rollup, dashboard KPIs, drilldown, rep detail, competitor signals

```yaml
id: WP-DSH-01
title: KPI rollup, dashboard KPIs, drilldown, rep detail, competitor signals
wave: 3
priority: P1
requirements: [REQ-DSH-001, REQ-DSH-002, REQ-DSH-003, REQ-DSH-004, REQ-DSH-006]
freeze: in
owns: [shared/handlers/src/kpi-rollup.ts, shared/handlers/test/kpi-rollup.test.ts, functions/kpi-rollup/**, shared/handlers/src/dashboard-kpis.ts, shared/handlers/test/dashboard-kpis.test.ts, functions/dashboard-kpis/**, shared/handlers/src/kpi-drilldown.ts, shared/handlers/test/kpi-drilldown.test.ts, functions/kpi-drilldown/**, shared/handlers/src/rep-detail.ts, shared/handlers/test/rep-detail.test.ts, functions/rep-detail/**, shared/handlers/src/competitor-signals-list.ts, shared/handlers/test/competitor-signals-list.test.ts, functions/competitor-signals-list/**, shared/handlers/src/team-list.ts, shared/handlers/test/team-list.test.ts, functions/team-list/**]
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
