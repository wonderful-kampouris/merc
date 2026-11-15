# WP-APV-01 · merc-approver: outbound voice agent, 3 tools, OnVoicemailDetected/OnEnd triggers, evals

```yaml
id: WP-APV-01
title: merc-approver: outbound voice agent, 3 tools, OnVoicemailDetected/OnEnd triggers, evals
wave: 3
priority: P0
requirements: [REQ-APV-001, REQ-APV-002, REQ-APV-003, REQ-DSC-003, REQ-DSC-008]
freeze: cut: discounts
owns: [agents/merc-approver/**]
depends_on: [WP-CORE-03, WP-LIVE-01, WP-CRM-01, WP-CRM-02, WP-DEB-01, WP-DEB-02, WP-APR-01, WP-DSC-01, WP-CRD-01, WP-CRD-02, WP-BRF-01, WP-ALR-01, WP-PLN-01, WP-PRS-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - agent created/updated in dev via wful agents (V2 repo under agents/<name>/), server validation passes, attached to the shared lib on main
  - every tool from spec/contracts/tools/<agent>/ implemented through the shared handler (runAsTool) with injected values from code, never from the model
  - evals in the agent repo run on dev with the listed thresholds; failures reported with transcripts
status: building
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
