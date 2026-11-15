# WP-CRD-02 · ask-crm safe templates, product lookup, my-performance

```yaml
id: WP-CRD-02
title: ask-crm safe templates, product lookup, my-performance
wave: 2
priority: P0
requirements: [REQ-CRD-004, REQ-CRD-005, REQ-TGT-002]
freeze: in
owns: [shared/handlers/src/ask-crm.ts, shared/handlers/test/ask-crm.test.ts, functions/ask-crm/**, shared/handlers/src/product-lookup.ts, shared/handlers/test/product-lookup.test.ts, functions/product-lookup/**, shared/handlers/src/my-performance.ts, shared/handlers/test/my-performance.test.ts, functions/my-performance/**, evals/ask-crm/**]
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
