# WP-CORE-02 · LLM helper + model profiles: structured calls validated against contracts/llm, evidence check helper

```yaml
id: WP-CORE-02
title: LLM helper + model profiles: structured calls validated against contracts/llm, evidence check helper
wave: 1
priority: P0
requirements: [REQ-CORE-003, REQ-DEB-004]
freeze: in
owns: [shared/llm/**]
depends_on: [WP-QA-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - model profiles merc-extract / merc-write / merc-decide exist on dev
  - `callStructured(name, input)` validates input+output against contracts/llm/<name>.json and retries once
  - evidence-substring + numbers-in-evidence validator with unit tests
  - hello-world structured call from a dev function works
status: done
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
