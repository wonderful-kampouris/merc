# WP-SPK-03 · Spikes S5+S6: prospect source for Greek shops; website scraping quality

```yaml
id: WP-SPK-03
title: Spikes S5+S6: prospect source for Greek shops; website scraping quality
wave: 0
priority: P0
requirements: [REQ-PRS-003, REQ-PRS-005, REQ-PRS-007, OPEN-05]
freeze: in
owns: [spikes/s5-s6/**, docs/spikes/S5-S6.md]
depends_on: []
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - ranked list of allowed sources (registries such as GEMI, open data, directory APIs) with terms-of-use notes; maps/review scraping excluded
  - for the best source: a sample query for bakeries in Chalandri (15231-15234) or the reason it is impossible, plus CSV fallback confirmed
  - 3 real Greek cafe/bakery websites fetched and the dossier facts extractable from them listed; Firecrawl key presence checked
status: done
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
