# WP-INF-03 · build.py emits the verified Tables payload; infra/tables applies it without translation; dry-run reads the platform; apply new column discount_request.buddy_conversation_id on dev

```yaml
id: WP-INF-03
title: build.py emits the verified Tables payload; infra/tables applies it without translation; dry-run reads the platform; apply new column discount_request.buddy_conversation_id on dev
wave: 1
priority: P0
requirements: [REQ-CORE-001, REQ-OPS-006]
freeze: in
owns: [infra/tables/**, spec/_build/build.py (function table_payload and the table checks only)]
depends_on: [WP-INF-01]
environment: {wful_profile: hackathon, dev_workspace: 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464}
acceptance:
  - contracts/tables/*.json create blocks equal the platform payload (per-column primary_key, reference merc.<t>, index type, names <= 49)
  - infra/tables applies them; re-run on dev is a no-op apart from the new column
  - python3 -I spec/_build/build.py exits 0
  - dry-run compares against the platform; temp files cleaned
status: building
```

## Rules
- Read `spec/SPEC.md` (the listed REQs), `spec/contracts/README.md` and the contracts you need. Contracts are law; if one is wrong, report a change request instead of deviating.
- Write only inside `owns`. Never edit `spec/` (unless a file there is listed in owns), `PROGRESS.md`, `wp/`, `docs/HUMAN-STEPS.md` or another WP's paths. Human-only blockers go in your report (human_steps), not into files.
- Platform: always `wful --profile hackathon --workspace 7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464`. Never touch the demo workspace or other teams' workspaces.
- No real emails, SMS or phone calls to anyone. Never delete platform resources or data you did not create in this WP.
- Report evidence: commands run with their output, resource ids created, failing checks.
