# WP-SPK-05 · Spikes S9+S10: identity injection, shared lib in tools, nested bodies; exact Tables/Function/Tool payload shapes

```yaml
id: WP-SPK-05
title: Spikes S9+S10: identity injection, shared lib in tools, nested bodies; exact Tables/Function/Tool payload shapes
wave: 0
priority: P0
requirements: [REQ-CORE-002, REQ-CORE-004, REQ-BUD-002, OPEN-08, OPEN-09, OPEN-10, REQ-OPS-006]
freeze: in
owns: [spikes/s9-s10/**, docs/spikes/S9-S10.md]
depends_on: []
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - a test table created in schema merc_spike with an auto_uuid PK, a FK and a unique index, then deleted (only that spike table)
  - a test function receiving a nested JSON POST body; how the caller identity reaches a function called from an App
  - how an Agents V2 tool gets session metadata and whether it can import the workspace shared lib
  - report lists the exact create payloads so build.py writers can be corrected
status: done
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
