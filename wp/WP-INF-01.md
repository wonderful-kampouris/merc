# WP-INF-01 · Table creation script: schema merc + 64 tables from contracts, idempotent, run on dev

```yaml
id: WP-INF-01
title: Table creation script: schema merc + 64 tables from contracts, idempotent, run on dev
wave: 1
priority: P0
requirements: [REQ-CORE-001]
freeze: in
owns: [infra/tables/**]
depends_on: [WP-SPK-05]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - `infra/tables/apply.sh --workspace <id>` creates all tables in _order.json, adds deferred self-refs, re-run is a no-op
  - dev workspace lists 64 tables in schema merc with FKs and indexes
  - writer mismatches vs contracts reported (for build.py fix)
status: done
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
