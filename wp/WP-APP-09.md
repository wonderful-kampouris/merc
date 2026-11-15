# WP-APP-09 · Screen contract follow-up: Record uses merc-chat-token for the buddy; Team/Dashboard/Pipeline/Targets/Competition use team-list + territories-list for names; drilldown on every KPI

```yaml
id: WP-APP-09
title: Screen contract follow-up: Record uses merc-chat-token for the buddy; Team/Dashboard/Pipeline/Targets/Competition use team-list + territories-list for names; drilldown on every KPI
wave: 3
priority: P0
requirements: [REQ-BUD-001, REQ-DSH-002, REQ-PLN-004]
freeze: in
owns: [app/app/src/screens/rep/record/**, app/app/src/screens/management/team/**, app/app/src/screens/management/dashboard/**, app/app/src/screens/management/pipeline/**, app/app/src/screens/management/targets/**, app/app/src/screens/management/competition/**]
depends_on: [WP-APP-03]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - screen tests match the updated app.json function lists
  - app/app pnpm test + build green
  - no deploy (WP-APP-08 deploys)
status: building
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
