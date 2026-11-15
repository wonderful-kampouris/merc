# WP-APP-01 · App scaffold: Wonderful App merc, rep + management shells, routes from app.json, i18n el/en, typed client with mock mode

```yaml
id: WP-APP-01
title: App scaffold: Wonderful App merc, rep + management shells, routes from app.json, i18n el/en, typed client with mock mode
wave: 1
priority: P0
requirements: [REQ-APP-001, REQ-APP-002, REQ-APP-005, REQ-CORE-011]
freeze: in
owns: [app/**]
depends_on: [WP-QA-01, WP-SPK-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - App created on dev, deployed, opens; role-based routing to every screen route in contracts/app/app.json (placeholder screens)
  - client `call(slug, body)` uses api.invokeFunction, validates with packages/contracts, mock mode on by flag
  - Greek default, English toggle
  - mobile layout for rep shell
status: partial
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
