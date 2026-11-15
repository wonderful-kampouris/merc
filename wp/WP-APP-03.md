# WP-APP-03 · Rep Record screen: offline queue, buddy voice widget with signed token, result card with undo

```yaml
id: WP-APP-03
title: Rep Record screen: offline queue, buddy voice widget with signed token, result card with undo
wave: 3
priority: P0
requirements: [REQ-DEB-001, REQ-DEB-003, REQ-APP-003, REQ-BUD-001]
freeze: in
owns: [app/app/src/screens/rep/record/**, evidence/WP-APP-03/**]
depends_on: [WP-CORE-03, WP-LIVE-01, WP-CRM-01, WP-CRM-02, WP-DEB-01, WP-DEB-02, WP-APR-01, WP-CRD-01, WP-CRD-02, WP-BRF-01, WP-ALR-01, WP-PLN-01, WP-APP-01b]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - screens live in app/app/src/screens/<shell>/<screen>/ and plug into the registry; only functions listed for the screen in app.json are called
  - Greek default + English; phone layout for rep screens; loading/empty/error states; mock mode works
  - component tests pass; app rebuilt and deployed to dev; screenshots at phone size in the WP evidence folder
status: in_review
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
