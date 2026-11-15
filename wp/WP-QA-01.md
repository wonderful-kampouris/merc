# WP-QA-01 · Contracts package: TS types + JSON-schema validators + mock handlers generated from spec/contracts

```yaml
id: WP-QA-01
title: Contracts package: TS types + JSON-schema validators + mock handlers generated from spec/contracts
wave: 1
priority: P0
requirements: [REQ-OPS-006, REQ-CORE-008]
freeze: in
owns: [packages/contracts/**]
depends_on: []
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - `pnpm -C packages/contracts build` generates types for every function request/response, _defs, events, llm schemas
  - validator `validateRequest(slug, body)` / `validateResponse(slug, body)` with tests on 5 functions
  - mock handler per function returning schema-valid sample data (seed-backed where possible)
  - `pnpm -C packages/contracts test` passes; regeneration is one command after build.py
status: done
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
