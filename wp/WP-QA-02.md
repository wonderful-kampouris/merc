# WP-QA-02 · Monitors, governance policy for external sends, visibility tests, performance

```yaml
id: WP-QA-02
title: Monitors, governance policy for external sends, visibility tests, performance
wave: 4
priority: P0
requirements: [REQ-OPS-003, REQ-OPS-004, REQ-CORE-009, REQ-NFR-001, REQ-NFR-002, REQ-NFR-003, REQ-NFR-005, REQ-NFR-006]
freeze: in
owns: [tests/visibility/**, tests/perf/**, infra/monitors/**, infra/governance/**]
depends_on: [WP-DSH-01, WP-TGT-01, WP-CMP-01, WP-SET-01, WP-OPS-02, WP-BUD-01, WP-BUD-02, WP-APP-02, WP-APP-03, WP-APP-04, WP-APP-09, WP-APP-08]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - monitors from platform.json exist on dev
  - rep A cannot read rep B outside shared territory
  - debrief p95 measured
  - CI eval gate script
status: building
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
