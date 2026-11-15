import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsSystem, validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { computeMetrics, handle, makeImpl, median } from "../src/metrics-rollup";

// Demo day 2026-11-16, 10:00 Athens (UTC+2 in November).
export const NOW = Date.parse("2026-11-16T08:00:00Z");
export const LOFOS = "24d14591-c8c2-5885-819a-c5e997f6cad0";
export const OLD_MILL = "897adb7c-9ee9-5102-a63a-19151c264052";
const run = (t: ReturnType<typeof kit>, data: unknown = {}) => runAsSystem("metrics-rollup", makeImpl({ now: () => NOW }), { tables: t.tables, data, orgId: IDS.org });

describe("computeMetrics (metrics.md #usual-frequency, #risk)", () => {
  const base = { today: "2026-11-16", account: { id: "a", visit_frequency_days: null, category_id: "c" }, categoryDefault: 7, doneVisitDates: ["2026-11-10"], recentSignals: 0, oldOpenProblems: 0 };
  it("median of gaps, even count averages the middle two", () => {
    expect(median([6, 9, 7, 8])).toBe(7.5);
    expect(computeMetrics({ ...base, confirmedOrderDates: ["2026-11-01", "2026-11-07", "2026-11-16", "2026-11-07"] }).avg_order_interval_days).toBe(7.5);
  });
  it("fewer than 3 dates in 180 days: account frequency, then category default, then 14", () => {
    expect(computeMetrics({ ...base, confirmedOrderDates: ["2026-11-01"] }).avg_order_interval_days).toBe(7);
    expect(computeMetrics({ ...base, account: { ...base.account, visit_frequency_days: 10 }, confirmedOrderDates: [] }).avg_order_interval_days).toBe(10);
    expect(computeMetrics({ ...base, categoryDefault: null, confirmedOrderDates: [] }).avg_order_interval_days).toBe(14);
    // orders older than 180 days do not count for the average, but still give the last order date
    const m = computeMetrics({ ...base, confirmedOrderDates: ["2026-01-01", "2026-01-08", "2026-01-15", "2026-11-01"] });
    expect(m.avg_order_interval_days).toBe(7);
    expect(m.last_order_date).toBe("2026-11-01");
  });
  it("no orders: days_since_last_order null, no order_gap", () => {
    const m = computeMetrics({ ...base, confirmedOrderDates: [] });
    expect(m).toMatchObject({ last_order_date: null, days_since_last_order: null, risk_score: 0, risk_reasons: null });
  });
  it("risk adds up and caps at 100", () => {
    // avg 7, 70 days since -> ratio 10 -> 60; + competitor 20 + problem 10 + no visit 10 = 100
    const m = computeMetrics({ ...base, confirmedOrderDates: ["2026-08-24", "2026-08-31", "2026-09-07"], doneVisitDates: [], recentSignals: 2, oldOpenProblems: 1 });
    expect(m.days_since_last_order).toBe(70);
    expect(m.risk_score).toBe(100);
    expect(m.risk_reasons).toBe("order_gap|competitor|open_problem|no_visit");
    // ratio exactly 1.5 counts (avg 6, 9 days): 40 x 0.5 = 20
    expect(computeMetrics({ ...base, confirmedOrderDates: ["2026-10-25", "2026-10-31", "2026-11-06"], today: "2026-11-15" }).risk_score).toBe(20);
  });
});

describe("fn:metrics-rollup on the seed", () => {
  it("Bistro Lofos matches the hand-computed values", async () => {
    // 24 confirmed orders 2026-05-22..2026-11-04; 23 gaps: nine 6s, five 7s, four 8s, five 9s -> median 7.
    // 12 days since 2026-11-04; ratio 12/7 = 1.71 -> round(40 x 0.71) = 29, reason order_gap.
    // Last done visit 2026-11-03 = 13 days <= 2 x 7, so no no_visit; no signals, no problems.
    const t = kit();
    const r = ok(await run(t));
    expect(r.processed).toBe(40);
    expect(r.created).toBe(40);
    const m = (await t.db.account_metrics.findOne({ account_id: LOFOS }))!;
    expect(m).toMatchObject({ avg_order_interval_days: 7, last_order_date: "2026-11-04", days_since_last_order: 12, last_visit_date: "2026-11-03", risk_score: 29, risk_reasons: "order_gap" });
  });

  it("Old Mill Café: median 8, 95 days quiet, risk 60 + 10 (no visit for 96 days)", async () => {
    const t = kit();
    ok(await run(t));
    const m = (await t.db.account_metrics.findOne({ account_id: OLD_MILL }))!;
    expect(m).toMatchObject({ avg_order_interval_days: 8, last_order_date: "2026-08-13", days_since_last_order: 95, last_visit_date: "2026-08-12", risk_score: 70, risk_reasons: "order_gap|no_visit" });
  });

  it("Café Miltos: open grinder problem older than 7 days adds open_problem", async () => {
    const t = kit();
    ok(await run(t));
    const m = (await t.db.account_metrics.findOne({ account_id: IDS.miltos }))!;
    expect(m.risk_reasons ?? "").toContain("open_problem");
  });

  it("is idempotent: a second run updates in place, one row per account", async () => {
    const t = kit();
    ok(await run(t));
    const r2 = ok(await run(t));
    expect(r2.created).toBe(0);
    expect(r2.details).toMatchObject({ updated: 40, unchanged: 40 });
    expect((await t.db.account_metrics.all()).length).toBe(40);
  });

  it("dry_run writes nothing", async () => {
    const t = kit();
    const r = ok(await run(t, { dry_run: true }));
    expect(r.created).toBe(40);
    expect((await t.db.account_metrics.all()).length).toBe(0);
  });

  it("contract: request and response validate; unknown params are refused", async () => {
    const t = kit();
    expect(validateRequest("metrics-rollup", { dry_run: null }).ok).toBe(true);
    expect(validateRequest("metrics-rollup", { bogus: 1 }).ok).toBe(false);
    expect(validateResponse("metrics-rollup", ok(await run(t))).ok).toBe(true);
  });

  it("cron entry runs once per org with a system principal; stray cron params are dropped", async () => {
    const t = kit();
    const out = await handle({ tables: t.tables, data: { dry_run: true, extra: "x" }, metadata: {} } as never);
    expect(out).toMatchObject({ slug: "metrics-rollup", orgs: 1, failed: 0 });
    expect((await t.db.account_metrics.all()).length).toBe(0);
  });

  it("functions/metrics-rollup/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "metrics-rollup", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("metrics-rollup"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
