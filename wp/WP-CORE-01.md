# WP-CORE-01 · Shared lib @merc/core: table data access, me(), scope checks, errors, contract validation

```yaml
id: WP-CORE-01
title: Shared lib @merc/core: table data access, me(), scope checks, errors, contract validation
wave: 1
priority: P0
requirements: [REQ-CORE-002, REQ-CORE-004, REQ-CORE-007, REQ-CORE-008, REQ-CORE-009]
freeze: in
owns: [shared/core/**]
depends_on: [WP-QA-01, WP-SPK-05]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - typed CRUD per table (from contracts) over the Wonderful tables API, with org/scope filters
  - me() resolves the platform caller to app_user; scope helpers owner/territory/team
  - unit tests with an in-memory table fake; packaging decided per S9 (workspace shared lib or bundled)
status: done
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
