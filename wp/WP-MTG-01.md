# WP-MTG-01 · Company profile + pre-meeting brief: product_guidance table, KB merc-company, visit-brief-get with push/avoid in code, visit_brief_bullets evals

```yaml
id: WP-MTG-01
title: Company profile + pre-meeting brief: product_guidance table, KB merc-company, visit-brief-get with push/avoid in code, visit_brief_bullets evals
wave: 2
priority: P0
requirements: [REQ-MTG-002, REQ-MTG-003, REQ-MTG-008]
freeze: in
owns: [shared/handlers/src/visit-brief-get.ts, shared/handlers/test/visit-brief-get.test.ts, functions/visit-brief-get/**, content/kb/merc-company/**, evals/visit-brief/**]
depends_on: [WP-QA-01b, WP-CORE-01b, WP-INF-03, WP-OPS-01b, WP-CORE-03, WP-LIVE-01, WP-CRD-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - apply tables product_guidance, visit_brief, debrief_confirmation, rep_feedback and the new visit/organization/buddy_call columns on dev with infra/tables; load the new seed rows
  - KB merc-company created in Context Hub on dev from content/kb/merc-company with infra/kb/apply.sh (if the script cannot take a third KB, report a change request to WP-CRD-01)
  - push/avoid chosen exactly as metrics.md#visit-brief-hints, unit-tested: campaign boost, category match, 30-day brief_not_useful skip, recent-order skip, avoid wins
  - visit facts reused from the visit-card-get handler (import, do not re-implement); LLM output with a product other than push/avoid is rejected; ungrounded numbers drop the bullet
  - evals/visit-brief: >= 10 cases (el, en, no guidance, out-of-stock avoid, feedback skip); 100% numbers grounded; Miltos brief names grinder, 12 kg, Espresso Nuovo push, Frappe Instant avoid
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
