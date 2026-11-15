# WP-SPK-02 · Spikes S3+S4: per-user Gmail send from a Function vs from a tool; offline audio transcription

```yaml
id: WP-SPK-02
title: Spikes S3+S4: per-user Gmail send from a Function vs from a tool; offline audio transcription
wave: 0
priority: P0
requirements: [REQ-APR-002, REQ-DEB-001, OPEN-03, OPEN-04]
freeze: in
owns: [spikes/s3-s4/**, docs/spikes/S3-S4.md]
depends_on: []
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - documented answer for OPEN-03 with doc citations and a test function/tool in dev that attempts the send path (no real customer address)
  - documented transcription path for an uploaded recording (OPEN-04) with a working call on a short Greek clip if any STT API exists
  - human steps listed (OAuth a test Gmail)
status: partial
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
