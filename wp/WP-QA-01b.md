# WP-QA-01b · Contracts package follow-ups: regenerate for 95 functions, counts derived from contracts, export llm purpose/rules/eval_set, validate mock fallbacks

```yaml
id: WP-QA-01b
title: Contracts package follow-ups: regenerate for 95 functions, counts derived from contracts, export llm purpose/rules/eval_set, validate mock fallbacks
wave: 1
priority: P0
requirements: [REQ-OPS-006]
freeze: in
owns: [packages/contracts/**]
depends_on: [WP-QA-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - tests derive counts from spec/contracts
  - llm export includes purpose, rules, eval_set
  - app/app/src/contracts and shared/core generated copies re-synced via their own sync/generate scripts (run them, do not hand-edit)
  - make check green
status: building
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
