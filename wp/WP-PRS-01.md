# WP-PRS-01 · Prospecting functions (Overpass/GEMI/CSV source, dedupe, scoring, candidate actions)

```yaml
id: WP-PRS-01
title: Prospecting functions (Overpass/GEMI/CSV source, dedupe, scoring, candidate actions)
wave: 2
priority: P0
requirements: [REQ-PRS-001, REQ-PRS-002, REQ-PRS-004, REQ-PRS-005, REQ-PRS-006, REQ-PRS-007, REQ-PRS-008]
freeze: cut: prospecting
owns: [shared/handlers/src/prospect-search.ts, shared/handlers/test/prospect-search.test.ts, functions/prospect-search/**, shared/handlers/src/candidate-add.ts, shared/handlers/test/candidate-add.test.ts, functions/candidate-add/**, shared/handlers/src/candidate-dedupe.ts, shared/handlers/test/candidate-dedupe.test.ts, functions/candidate-dedupe/**, shared/handlers/src/candidate-get.ts, shared/handlers/test/candidate-get.test.ts, functions/candidate-get/**, shared/handlers/src/candidate-score.ts, shared/handlers/test/candidate-score.test.ts, functions/candidate-score/**, shared/handlers/src/candidates-list.ts, shared/handlers/test/candidates-list.test.ts, functions/candidates-list/**, shared/handlers/src/candidate-act.ts, shared/handlers/test/candidate-act.test.ts, functions/candidate-act/**, shared/handlers/src/directory-search.ts, shared/handlers/test/directory-search.test.ts, functions/directory-search/**, shared/handlers/src/dossier-save.ts, shared/handlers/test/dossier-save.test.ts, functions/dossier-save/**, shared/handlers/src/search-finalize.ts, shared/handlers/test/search-finalize.test.ts, functions/search-finalize/**]
depends_on: [WP-QA-01b, WP-CORE-01b, WP-INF-03, WP-OPS-01b, WP-CORE-03, WP-LIVE-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - egress from a deployed function to overpass-api.de tested (OPEN-18)
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
