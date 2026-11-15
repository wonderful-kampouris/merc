import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsSystem, runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { makeImpl } from "../src/dashboard-kpis";
import { makeImpl as rollup } from "../src/kpi-rollup";

// ---- seed fixtures (demo day 2026-11-16) ----
import { runAsSystem as _runAsSystem } from "../../core/src/index";
import { kit as _kit, IDS as _IDS } from "../src/_lib/testkit";
import { makeImpl as _metricsRollup } from "../src/metrics-rollup";
/** Demo day 2026-11-16, 10:00 Athens (UTC+2 in November). */
const NOW = Date.parse("2026-11-16T08:00:00Z");
const FROM = "2026-10-17"; // go-live (seed @D-30)
const TO = "2026-11-16";
const AROMA = "94cc0e65-3b44-5d48-b419-32e51aa11446";
const BLUEBEAN = "8fac56e5-0862-50b1-b242-bb37ac0c98e1";
const MARIA = _IDS.center_rep;
const GIORGOS = "51f64164-9fae-56a4-a1d2-46b24def92e8";
const REPS = [_IDS.nikos, _IDS.dimitra, MARIA, GIORGOS];

/** A seeded kit whose account_metrics were rebuilt by fn:metrics-rollup at NOW (what dev has after the hourly cron). */
async function seededKit() {
  const t = _kit();
  await _runAsSystem("metrics-rollup", _metricsRollup({ now: () => NOW }), { tables: t.tables, data: {}, orgId: _IDS.org });
  return t;
}

/** Hand query: confirmed revenue of the reps between from..to (metrics.md#target-progress revenue). */
async function handRevenue(t: ReturnType<typeof _kit>, reps: string[], from: string, to: string): Promise<number> {
  let total = 0;
  for (const o of await t.db.sales_order.all({ status: "confirmed" })) {
    if (!reps.includes(o.rep_id) || o.order_date < from || o.order_date > to) continue;
    for (const l of await t.db.order_line.all({ order_id: o.id })) total += Math.round(l.quantity * l.unit_price_minor * (1 - (l.discount_pct ?? 0) / 100));
  }
  return total;
}

const impl = makeImpl({ now: () => NOW });
const handle = defineFunction("dashboard-kpis", impl);
const q = (extra: Record<string, unknown> = {}) => ({ scope: "team", from: FROM, to: TO, ...extra });

describe("fn:dashboard-kpis (REQ-DSH-001, REQ-DSH-004)", () => {
  it("the seed's team KPIs match a hand query and validate against the contract", async () => {
    const t = await seededKit();
    const out = ok(await handle(t.fnCtx("eleni", q())));
    expect(validateResponse("dashboard-kpis", out).ok).toBe(true);
    expect(out.kpis.revenue_minor).toBe(await handRevenue(t, REPS, FROM, TO));
    const atRisk = await t.db.account.all({ owner_rep_id: REPS, account_type: "customer" });
    const metrics = new Map((await t.db.account_metrics.all()).map((m) => [m.account_id, m]));
    expect(out.kpis.at_risk_customers).toBe(atRisk.filter((a) => (metrics.get(a.id)?.risk_score ?? 0) >= 20).length);
    expect(out.kpis.lost_customers).toBe((await t.db.account.all({ owner_rep_id: REPS, account_type: "lost" })).length);
    const open = (await t.db.deal.all({ owner_id: REPS })).filter((d) => ["new", "qualified", "proposal", "negotiation"].includes(d.stage_code));
    expect(out.kpis.pipeline_by_stage.reduce((s, r) => s + r.amount_minor, 0)).toBe(open.reduce((s, d) => s + (d.amount_minor ?? 0), 0));
    expect(out.by_rep.map((r) => r.rep.id).sort()).toEqual([...REPS].sort());
    expect(out.by_rep.reduce((s, r) => s + (r.kpis.revenue_minor as number), 0)).toBe(out.kpis.revenue_minor);
    expect(out.kpis.baseline ?? null).toBeNull();
  });

  it("rep_id and territory_id narrow the reps; a rep sees only their own numbers", async () => {
    const t = await seededKit();
    const nikos = ok(await handle(t.fnCtx("eleni", q({ rep_id: IDS.nikos }))));
    expect(nikos.by_rep.map((r) => r.rep.id)).toEqual([IDS.nikos]);
    expect(nikos.kpis.revenue_minor).toBe(await handRevenue(t, [IDS.nikos], FROM, TO));
    const north = ok(await handle(t.fnCtx("eleni", q({ territory_id: IDS.north }))));
    expect(north.by_rep.map((r) => r.rep.id).sort()).toEqual([IDS.nikos, IDS.dimitra].sort());
    const own = ok(await handle(t.fnCtx("nikos", q({ scope: "me" }))));
    expect(own.kpis.revenue_minor).toBe(nikos.kpis.revenue_minor);
    expect(errCode(await handle(t.fnCtx("nikos", q({ rep_id: IDS.dimitra }))))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("eleni", q({ scope: "org" }))))).toBe("forbidden");
    const org = ok(await handle(t.fnCtx("thanasis", q({ scope: "org" }))));
    expect(org.by_rep.map((r) => r.rep.id).sort()).toEqual([...REPS].sort());
    expect(errCode(await handle(t.fnCtx("eleni", q({ from: TO, to: FROM }))))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx(null, q())))).toBe("forbidden");
  });

  it("before/after against the baseline (metrics.md#before-after)", async () => {
    const t = await seededKit();
    const out = ok(await handle(t.fnCtx("eleni", q({ compare_baseline: true }))));
    const b = out.kpis.baseline as any;
    expect(b.period).toEqual({ from: "2026-07-19", to: "2026-10-16" });
    expect(b.after.period).toEqual({ from: "2026-10-17", to: "2026-11-16" });
    expect(b.revenue_minor).toBe(await handRevenue(t, REPS, "2026-07-19", "2026-10-16"));
    expect(b.after.revenue_minor).toBe(await handRevenue(t, REPS, "2026-10-17", "2026-11-16"));
    expect(b.after.crm_completeness_pct).toBe(out.kpis.crm_completeness_pct);
    // no stored history yet: completeness before go-live is unknown, not invented
    expect(b.crm_completeness_pct).toBeNull();
    // stored kpi_daily rows in the baseline window feed the before value
    await t.db.kpi_daily.insert({ rep_id: IDS.nikos, day: "2026-08-03", crm_completeness_pct: 40, visits_done: 0 });
    await t.db.kpi_daily.insert({ rep_id: MARIA, day: "2026-08-03", crm_completeness_pct: 60, visits_done: 0 });
    const again = ok(await handle(t.fnCtx("eleni", q({ compare_baseline: true }))));
    expect((again.kpis.baseline as any).crm_completeness_pct).toBe(50);
    expect((again.kpis.baseline as any).baseline_days_stored).toBe(1);
  });

  it("days written by fn:kpi-rollup are read from tbl:kpi_daily, the rest live (same totals)", async () => {
    const t = await seededKit();
    const live = ok(await handle(t.fnCtx("eleni", q())));
    await runAsSystem("kpi-rollup", rollup({ now: () => NOW }), { tables: t.tables, data: {}, orgId: IDS.org });
    expect(await t.db.kpi_daily.count()).toBe(4);
    const mixed = ok(await handle(t.fnCtx("eleni", q())));
    expect(mixed.kpis).toEqual(live.kpis);
    // a stored figure wins for its day (it is what the rollup saw)
    const row = (await t.db.kpi_daily.findOne({ rep_id: GIORGOS, day: "2026-11-15" }))!;
    await t.db.kpi_daily.update(row.id, { revenue_minor: (row.revenue_minor ?? 0) + 100 });
    expect(ok(await handle(t.fnCtx("eleni", q()))).kpis.revenue_minor).toBe(live.kpis.revenue_minor + 100);
  });

  it("a spoofed caller is ignored, unknown fields fail, and the tool path gives the same answer", async () => {
    const t = await seededKit();
    const base = ok(await handle(t.fnCtx("nikos", q({ scope: "me" }))));
    expect(errCode(await handle(t.fnCtx("nikos", { ...q({ scope: "me" }), caller: IDS.thanasis })))).toBe(null);
    expect(ok(await handle(t.fnCtx("nikos", { ...q({ scope: "me" }), caller: IDS.thanasis })))).toEqual(base);
    expect(validateRequest("dashboard-kpis", { ...q(), bogus: 1 }).ok).toBe(false);
    expect(await runAsTool("dashboard-kpis", impl, t.toolCtx("nikos"), q({ scope: "me" }), t.key)).toEqual(base);
  });

  it("functions/dashboard-kpis/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "dashboard-kpis", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("dashboard-kpis"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
