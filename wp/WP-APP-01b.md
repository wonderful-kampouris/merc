# WP-APP-01b · App screen registry: route -> lazy screen module with placeholder fallback; one folder per screen; per-screen i18n dictionaries

```yaml
id: WP-APP-01b
title: App screen registry: route -> lazy screen module with placeholder fallback; one folder per screen; per-screen i18n dictionaries
wave: 1
priority: P0
requirements: [REQ-APP-001, REQ-APP-005]
freeze: in
owns: [app/app/src/App.tsx, app/app/src/shell/**, app/app/src/lib/**, app/app/src/screens/registry.ts, app/app/src/screens/README.md]
depends_on: [WP-APP-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - screens/registry.ts maps every app.json route to app/app/src/screens/<shell>/<screen>/index.tsx when present, else the placeholder
  - a screen can register its own i18n strings from its folder; README explains the contract a screen WP follows (props, client via forScreen, live events)
  - app tests + build pass; redeployed to dev
status: building
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
