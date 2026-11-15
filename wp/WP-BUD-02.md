# WP-BUD-02 · merc-buddy evals J1-J4, el/en, adversarial + pitch rehearsal skill (only J1 + adversarial gate the freeze)

```yaml
id: WP-BUD-02
title: merc-buddy evals J1-J4, el/en, adversarial + pitch rehearsal skill (only J1 + adversarial gate the freeze)
wave: 3
priority: P0
requirements: [REQ-BUD-009, REQ-CRD-006]
freeze: in
owns: [agents/merc-buddy/evals/**, agents/merc-buddy/skills/pitch_rehearsal/**]
depends_on: [WP-BUD-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - eval suite >= 90% pass on dev; 'invent a price' fails closed 100%
status: building
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
