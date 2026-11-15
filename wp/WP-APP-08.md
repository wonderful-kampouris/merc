# WP-APP-08 · App integration: one deploy of all screens with live functions attached, mock off, smoke every screen on dev

```yaml
id: WP-APP-08
title: App integration: one deploy of all screens with live functions attached, mock off, smoke every screen on dev
wave: 3
priority: P0
requirements: [REQ-APP-001, REQ-APP-002, REQ-APP-003, REQ-CORE-011]
freeze: in
owns: [app/app/package.json, app/app/vite.config.ts, evidence/WP-APP-08/**]
depends_on: [WP-APP-02, WP-APP-03, WP-APP-04, WP-APP-09, WP-CORE-03, WP-LIVE-01, WP-CRM-01, WP-CRM-02, WP-DEB-01, WP-DEB-02, WP-APR-01, WP-CRD-01, WP-CRD-02, WP-BRF-01, WP-ALR-01, WP-PLN-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - app merc rebuilt and deployed once to dev with every screen
  - all app-callable functions attached as app resources
  - each screen opens with live data for a rep and a manager test principal (or the exact blocker is listed)
  - phone-size screenshots of every screen in evidence/WP-APP-08/
status: building
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
