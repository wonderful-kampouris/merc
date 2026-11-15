# WP-E2E-01 · J1 end to end (API + browser) on dev from reseed

```yaml
id: WP-E2E-01
title: J1 end to end (API + browser) on dev from reseed
wave: 4
priority: P0
requirements: [J1: BRF, CRD, DEB, APR, BUD]
freeze: in
owns: [tests/e2e/j1/**]
depends_on: [WP-DSH-01, WP-TGT-01, WP-CMP-01, WP-SET-01, WP-OPS-02, WP-BUD-01, WP-BUD-02, WP-APP-02, WP-APP-03, WP-APP-04, WP-APP-09, WP-APP-08]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - scripted run twice from reseed passes; voice steps simulated by tool calls where audio is impossible; real-phone run listed as a human step
status: todo
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
