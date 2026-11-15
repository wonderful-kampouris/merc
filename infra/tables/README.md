# infra/tables (WP-INF-01, WP-INF-03)

Creates schema `merc` from `spec/contracts/tables` (REQ-CORE-001).

```
infra/tables/apply.sh  --workspace <id> [--profile hackathon] [--dry-run]
infra/tables/verify.sh --workspace <id> [--profile hackathon]     # read-only
pnpm -C infra/tables test && pnpm -C infra/tables typecheck
```

- The contract `create` blocks written by `spec/_build/build.py` are the verified Tables payload
  (WP-SPK-05, `docs/spikes/S9-S10.md`): per-column `primary_key: true`,
  `reference: {table: "merc.<t>", on_delete}`, index `type`, `unique` only when true, index names of
  at most 49 characters (deterministic hash suffix, keeps `_uq`/`_idx`). They are sent **unchanged**.
  `src/payload.ts` only validates the shape (a legacy shape fails the run) and drops deferred self-refs
  for phase 1.
- Phase 1 creates tables in `_order.json` order. Deferred self-refs (`app_user.manager_id`) are left
  out with their indexes, because the platform rejects an inline FK to the table being created and a
  non-PK `auto_uuid` column without an FK. Phase 2 adds them with `tables update`.
- Re-run: an existing table is diffed against the contract (`src/diff.ts`). Missing columns, FKs and
  indexes are added (extra platform columns and indexes are kept). Type, required, PK or FK changes
  are reported as `DRIFT` and never applied (exit 1). No change means a no-op.
- `--dry-run` reads every table from the platform, prints `create`/`update`/`ok`/`DRIFT` exactly as a
  real run would, and writes nothing (`out/last-dry-run.log`). It needs `--workspace`.
- Request bodies go to a private `mkdtemp` dir that is removed after each call, success or failure.
- `out/last-run.log` is the last real run's log.
