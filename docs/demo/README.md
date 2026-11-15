# Demo kit (WP-DEMO-01)

| File | What |
|---|---|
| [`demo-script.md`](demo-script.md) | The 3-minute J5 live demo: setup from T-15, beats with timings, a fallback per beat, troubleshooting |
| [`fallback-video.md`](fallback-video.md) | How to record, cut and use the five fallback clips |
| [`promotion-runbook.md`](promotion-runbook.md) | Dev to demo: gate, order, smoke, rollback (a human runs it) |
| [`promotion-dry-run.txt`](promotion-dry-run.txt) | Generated offline plan: `node --experimental-strip-types infra/demo/src/promote-plan.ts --env demo --out docs/demo/promotion-dry-run.txt` |

The code is in [`infra/demo`](../../infra/demo/README.md). `reset-demo.sh` puts the seed back in under a minute, and `--next-visit-in <min>` makes the brief fire live.
