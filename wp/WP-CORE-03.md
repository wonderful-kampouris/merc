# WP-CORE-03 · Autonomy engine (propose/apply/undo, ai_permission modes) as shared/autonomy + ai-action-undo, ai-actions-list

```yaml
id: WP-CORE-03
title: Autonomy engine (propose/apply/undo, ai_permission modes) as shared/autonomy + ai-action-undo, ai-actions-list
wave: 2
priority: P0
requirements: [REQ-CORE-005, REQ-CORE-006]
freeze: in
owns: [shared/handlers/src/ai-action-undo.ts, shared/handlers/test/ai-action-undo.test.ts, functions/ai-action-undo/**, shared/handlers/src/ai-actions-list.ts, shared/handlers/test/ai-actions-list.test.ts, functions/ai-actions-list/**, shared/autonomy/**]
depends_on: [WP-QA-01b, WP-CORE-01b, WP-INF-03, WP-OPS-01b]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - shared/autonomy: propose(action) reads ai_permission -> auto (snapshot + apply + ai_action) / ask (approval row) / never (suggested); destructive always blocked; undo round-trips every internal action type
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
