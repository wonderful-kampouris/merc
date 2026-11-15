# infra/demo (WP-DEMO-01)

The demo kit's code. The runbooks and the demo script are in `docs/demo/`.

```
infra/demo/reset-demo.sh --env dev|demo [--demo-day YYYY-MM-DD] [--dry-run] [--no-cleanup] [--keep-feedback] [--concurrency 24]
infra/demo/reset-demo.sh --env dev|demo --next-visit-in <minutes> --live-phone-ok   # reset, then the brief fires live
infra/demo/reset-demo.sh --env dev|demo --prompt-now --live-phone-ok                # mid-demo: visit ended, "How did it go?"
node --experimental-strip-types infra/demo/src/promote-plan.ts --env demo --out docs/demo/promotion-dry-run.txt
pnpm -C infra/demo test && pnpm -C infra/demo typecheck
```

## reset-demo

It puts an environment back to the J5 start (Café Miltos) in under a minute (REQ-OPS-002).

1. **Clean.** It deletes the rows a J5 run created around Café Miltos: voice logs, the visit brief, the debrief confirmation, the rep feedback, buddy calls, the debrief's orders and order lines, tasks, activities and AI actions (`cleanupPlan` in `src/demo-loop.ts`). It deletes children first. A seed row is never deleted, and neither is a row of another account. A left-over `brief_not_useful` row would stop the next brief from pushing Espresso Nuovo for 30 days, so the clean step matters.
2. **Converge the seed.** It uses the `infra/seed` planner (same tokens, same `phones.json` overlay), lists every table in parallel, inserts in seed order, then sends every PUT in parallel (24 at a time). On the Café Miltos seed rows (visit, grinder problem, tasks, deals, orders), each column the seed leaves out is reset to null too, so the visit's `outcome`, `started_at` and `completed_at` are cleared.
3. **`--next-visit-in N`.** It moves the Miltos visit to start N minutes from now, today. The deployed `previsit-briefs-due` cron (every 5 min, 30 min lead) sends the brief at its first tick inside the window. The script prints the expected tick. With N ≤ 30, the brief goes out at the next tick (≤ 5 min).
4. **`--prompt-now`.** This only moves the visit: it now ended 11 minutes ago, so `postvisit-prompts-due` asks "How did it go at Café Miltos?" at its next tick. The brief and call rows stay.

`--keep-feedback` keeps the J5 `rep_feedback` rows. It is used only to record the "next week brief pushes Hot Chocolate" clip ([`docs/demo/fallback-video.md`](../../docs/demo/fallback-video.md)). Run a full reset afterwards.

Safety:
- `--env` has no default. The workspace comes only from `infra/deploy/environments.json`.
- `--next-visit-in` and `--prompt-now` make live crons message the rep's **real** phone (`phones.json`, `MERC_CHANNELS_LIVE`). Both refuse to run without `--live-phone-ok`, except with `--dry-run`.
- `--dry-run` reads everything and writes nothing. Run it first.
- The seed plans several visits for Nikos today, some of them in the morning. Where `postvisit-prompts-due` is deployed, each planned visit of today that is already past gets one "How did it go?" (once per visit: it skips a visit that already has a post_visit buddy call). The reset deletes Café Miltos's buddy calls, so a plain reset after 11:25 re-prompts Miltos. Reset with `--next-visit-in`, or load the new demo day early in the morning.

Timings measured on dev (2026-11-15, 2712 seed rows):

| Run | Time |
|---|---|
| Same-day reset (dev already on the seed), real run | 2.6 s (`{"inserted":0,"updated":0,"same":2712}`) |
| New demo day, dry run: 1122 rows to update | 2.6 s to plan |
| PUT throughput, 240 same-value PUTs at concurrency 24 | 3.8 s (63 PUT/s), so the 1122 PUTs of a new demo day take about 18 s and the full reset about 21 s |

## promote-plan

This is the offline dry run for the demo workspace (REQ-OPS-001). It reads `promotion.json` (everything J5 needs) and `environments.json`. It checks that the demo env is filled in and is not the dev workspace, and that every function folder exists. Then it prints the ordered runbook, with `deploy.sh <c> --env demo --print-plan` for each component. `--print-plan` exits before git or the network. Nothing here calls `wful` or deploys anything.
