# WP-CORE-01b · Shared lib follow-ups + function pattern: systemPrincipal, org-timezone dates, scope fix, 500 mapping, merge merc-core to shared_lib main, @merc/handlers package skeleton, functions me + merc-chat-token deployed, builder guide

```yaml
id: WP-CORE-01b
title: Shared lib follow-ups + function pattern: systemPrincipal, org-timezone dates, scope fix, 500 mapping, merge merc-core to shared_lib main, @merc/handlers package skeleton, functions me + merc-chat-token deployed, builder guide
wave: 1
priority: P0
requirements: [REQ-CORE-002, REQ-CORE-004, REQ-CORE-007, REQ-CORE-009, REQ-BUD-002]
freeze: in
owns: [shared/core/**, shared/handlers/package.json, shared/handlers/tsconfig.json, shared/handlers/src/_lib/**, shared/handlers/src/me.ts, shared/handlers/test/me.test.ts, functions/me/**, shared/handlers/src/merc-chat-token.ts, shared/handlers/test/merc-chat-token.test.ts, functions/merc-chat-token/**, docs/guides/function-wp.md]
depends_on: [WP-CORE-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - systemPrincipal(orgId) for scheduler/procedure callers; today()/range helpers in org timezone, with tests
  - op-conditions on scoped lists kept; 500 only mapped to conflict after a confirmed unique clash
  - merc-core merged to shared_lib main on dev; shared/handlers package (impl per file, no barrel) with test helpers in src/_lib (seeded in-memory db, principal builders)
  - functions me and merc-chat-token deployed to dev and attached to app merc; merc-chat-token returns a clear blocked error while MERC_CHAT_API_KEY is missing
  - docs/guides/function-wp.md: exact steps to add a handler, wrapper, deploy, attach to the app, smoke-call; every wave 2 builder follows it
status: building
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
