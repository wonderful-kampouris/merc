# infra/seed (WP-INF-02)

Loads `spec/contracts/seed` into schema `merc` in `seed/_order.json` order, resolving the seed tokens (REQ-OPS-002).

```
infra/seed/load.sh  --workspace <id> --demo-day YYYY-MM-DD [--reset] [--profile hackathon] [--wuid-file f] [--dry-run]
infra/seed/check.sh --workspace <id> --demo-day YYYY-MM-DD [--account "Bistro Lofos"] [--expect 12]
pnpm -C infra/seed test && pnpm -C infra/seed typecheck
```

- Tokens (`src/tokens.ts`): `@D`, `@D±N` give a date. `@D±N@HH:MM` gives local org time (`organization.timezone`,
  Europe/Athens) as RFC3339 with that day's DST offset; the platform stores it as UTC. `@WEEK_START` is the ISO Monday of
  the demo week. `@MONTH_START` and `@MONTH_END` are the demo month's first and last days. `@wuid:<key>` comes from `wuid.json`.
- `wuid.json` (gitignored, copy `wuid.example.json`) maps demo user keys to Wonderful user ids. A missing key gets the
  placeholder `merc-demo-wuid-<key>` and a warning. Fill it in and re-run to update `app_user.wonderful_user_id`.
- Converges: each table is listed, missing rows are bulk-inserted (200 per call), changed fields are PUT, and identical
  rows are skipped (datetimes are compared as instants). The same demo day twice gives a no-op. A new demo day updates the dates.
- Self-references (`app_user.manager_id`) are inserted as null, then set once all rows of the table exist.
- `phones.json` (gitignored, never published; copy `phones.example.json`) maps user keys to real team mobiles for phone/WhatsApp
  tests (REQ-BUD-013). Listed users get that phone and `phone_channel_enabled=true`; all other seed users get
  `phone_channel_enabled=false`, so Merc never dials a seed number. `--phones-file` overrides the path.
- `--reset` deletes **only rows whose key is in the seed**, children first (`bulk-delete` with `in`), then reloads.
  Rows created by the app or other WPs are not touched. A restrict FK from a non-seed row makes that reset step FAIL.
- `out/last-run.log` is the last run's log.
