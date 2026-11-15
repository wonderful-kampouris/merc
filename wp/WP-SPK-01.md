# WP-SPK-01 · Spikes S1+S2: Wonderful App in a phone browser; Chat SDK voice widget inside the App

```yaml
id: WP-SPK-01
title: Spikes S1+S2: Wonderful App in a phone browser; Chat SDK voice widget inside the App
wave: 0
priority: P0
requirements: [REQ-APP-002, REQ-BUD-001]
freeze: in
owns: [spikes/s1-s2/**, docs/spikes/S1-S2.md]
depends_on: []
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - hello-world App deployed to dev with a public/internal URL
  - a test voice agent embedded with @wonderful/chat (voice) in that App
  - report: URL, auth model on mobile, mic permission behaviour, decision internal vs external app (progress 0.8)
  - human step listed: open the URL on a real phone and talk
status: done
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
