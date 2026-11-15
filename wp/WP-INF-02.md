# WP-INF-02 · Seed loader: resolve tokens, load contracts/seed in order, reset mode

```yaml
id: WP-INF-02
title: Seed loader: resolve tokens, load contracts/seed in order, reset mode
wave: 1
priority: P0
requirements: [REQ-OPS-002]
freeze: in
owns: [infra/seed/**]
depends_on: [WP-INF-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - unit tests for token resolution (@D, @D-3@09:30, @WEEK_START, @MONTH_*, @wuid)
  - `infra/seed/load.sh --workspace <id> --demo-day YYYY-MM-DD [--reset]` loads all seed rows on dev
  - check query: Bistro Lofos days since last order = 12 on demo day
status: done
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
