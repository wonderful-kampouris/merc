# WP-SPK-04 · Spikes S7+S8: start one outbound call to the manager from a Function; relay the decision into the live buddy conversation

```yaml
id: WP-SPK-04
title: Spikes S7+S8: start one outbound call to the manager from a Function; relay the decision into the live buddy conversation
wave: 0
priority: P0
requirements: [REQ-DSC-002, REQ-DSC-005, REQ-APV-001, OPEN-07]
freeze: in
owns: [spikes/s7-s8/**, docs/spikes/S7-S8.md]
depends_on: []
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - documented API path: campaign + consumer created from code, phone numbers available in the tenant, call metadata passing, outcome hook
  - dry-run proof up to (not including) dialing a real number; NO real calls
  - S8 options compared (polling tool, hold/wait, push+SMS) with a recommendation
  - human step listed: one real test call to a team phone
status: partial
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
