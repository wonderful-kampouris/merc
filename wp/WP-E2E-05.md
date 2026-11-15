# WP-E2E-05 · J5 end to end: brief 30 min before, Call me, post-visit prompt, debrief, WhatsApp confirm, Fix stored as feedback

```yaml
id: WP-E2E-05
title: J5 end to end: brief 30 min before, Call me, post-visit prompt, debrief, WhatsApp confirm, Fix stored as feedback
wave: 4
priority: P0
requirements: [J5: MTG, BUD, DEB, CRD]
freeze: in
owns: [tests/e2e/j5/**]
depends_on: [WP-MTG-02, WP-BUD-01, WP-BUD-03, WP-DEB-01, WP-APP-03, WP-APP-08]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - scripted run twice from reseed passes with a fixed clock; WhatsApp and calls simulated by tool calls when the channel is not live
  - the second Miltos brief after 'Brief did not help' pushes a different product
  - real-phone run (WhatsApp brief, Call me, confirmation) listed as a human step with the exact order
status: building
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
