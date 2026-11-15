# WP-DEMO-01 · Demo kit: reset script, promotion runbook to Team Delta, demo script with timings

```yaml
id: WP-DEMO-01
title: Demo kit: reset script, promotion runbook to Team Delta, demo script with timings
wave: 4
priority: P0
requirements: [REQ-OPS-001, REQ-OPS-002]
freeze: in
owns: [infra/demo/**, docs/demo/**]
depends_on: [WP-MTG-02, WP-E2E-05, WP-BUD-01, WP-APP-08]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - reset-demo reseeds dev in < 1 min and supports --next-visit-in <minutes> (shifts the Miltos visit so the pre-meeting brief fires live)
  - promotion runbook + dry-run plan for demo (no deploy until the human fills environments.json demo)
  - 3-minute demo script for J5 with timings, plus a recorded fallback video plan
status: partial
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
