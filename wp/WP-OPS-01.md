# WP-OPS-01 · Repo layout + deploy scripts: monorepo -> platform repos sync, dev/demo workspace config, check script

```yaml
id: WP-OPS-01
title: Repo layout + deploy scripts: monorepo -> platform repos sync, dev/demo workspace config, check script
wave: 1
priority: P0
requirements: [REQ-OPS-001, REQ-OPS-005, REQ-OPS-006]
freeze: in
owns: [infra/deploy/**, scripts/**, Makefile]
depends_on: []
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - decision on monorepo vs platform repos documented (docs/spikes/repo-layout.md)
  - `make check` runs build.py + all package tests
  - `infra/deploy/deploy.sh <component> --env dev|demo` skeleton for functions/agents/app with workspace ids from one config file
  - never deploys to demo without --env demo explicitly
status: done
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
