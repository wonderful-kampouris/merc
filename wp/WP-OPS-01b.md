# WP-OPS-01b · Deploy follow-ups: Makefile ignores ENV from the shell, agent plan shows target, check.sh tolerant of packages without tests and includes shared/handlers

```yaml
id: WP-OPS-01b
title: Deploy follow-ups: Makefile ignores ENV from the shell, agent plan shows target, check.sh tolerant of packages without tests and includes shared/handlers
wave: 1
priority: P1
requirements: [REQ-OPS-001]
freeze: in
owns: [infra/deploy/**, scripts/**, Makefile]
depends_on: [WP-OPS-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - `ENV=demo make plan` does not target demo
  - agent plan prints the clone target
  - make check covers shared/handlers and stays green
status: building
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
