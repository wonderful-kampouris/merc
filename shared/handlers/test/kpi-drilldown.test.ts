import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { makeImpl } from "../src/kpi-drilldown";
import { makeImpl as dashboard } from "../src/dashboard-kpis";

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
const handle = defineFunction("kpi-drilldown", impl);
const kpis = defineFunction("dashboard-kpis", dashboard({ now: () => NOW }));
const q = (kpi: string, extra: Record<string, unknown> = {}) => ({ kpi, from: FROM, to: TO, limit: 500, ...extra });

describe("fn:kpi-drilldown (REQ-DSH-002)", () => {
  it("every KPI drills down to exactly the records it counts", async () => {
    const t = await seededKit();
    const k = ok(await kpis(t.fnCtx("eleni", { scope: "team", from: FROM, to: TO }))).kpis;
    const drill = async (kpi: string, extra = {}) => { const r = ok(await handle(t.fnCtx("eleni", q(kpi, extra)))); expect(validateResponse("kpi-drilldown", r).ok).toBe(true); return r; };

    const risk = await drill("at_risk");
    expect(risk.page.total).toBe(k.at_risk_customers);
    expect(risk.items.reduce((s, i: any) => s + i.at_risk_value_minor, 0)).toBe(k.at_risk_value_minor);
    expect(risk.items.every((i: any) => i.risk_score >= 20 && i.account_type === "customer")).toBe(true);

    const rev = await drill("revenue");
    expect(rev.items.reduce((s, i: any) => s + i.amount_minor, 0)).toBe(k.revenue_minor);
    const pipe = await drill("pipeline");
    expect(pipe.items.reduce((s, i: any) => s + i.weighted_minor, 0)).toBe(k.weighted_pipeline_minor);
    expect(pipe.page.total).toBe(k.pipeline_by_stage.reduce((s, r) => s + r.count, 0));
    expect((await drill("lost")).page.total).toBe(k.lost_customers);
    expect((await drill("new_customers")).page.total).toBe(k.new_customers);
    expect((await drill("customers_saved")).page.total).toBe(k.customers_saved);
    expect((await drill("incomplete_accounts")).page.total).toBe(0); // seed completeness is 100%
    const visits = await drill("visits");
    expect(visits.page.total).toBe(ok(await kpis(t.fnCtx("eleni", { scope: "team", from: FROM, to: TO }))).by_rep.reduce((s, r) => s + (r.kpis.visits_done as number), 0));
    const low = await drill("low_logging");
    expect(low.items.map((i: any) => i.rep_id).sort()).toEqual(ok(await kpis(t.fnCtx("eleni", { scope: "team", from: FROM, to: TO }))).by_rep.map((r) => r.rep.id).sort());
    const stuck = await drill("stuck_deals");
    expect(stuck.items.length).toBeGreaterThan(0);
    expect(stuck.items.every((i: any) => Date.parse(i.last_activity_at) < NOW - 14 * 86_400_000)).toBe(true);
    for (const kpi of ["ai_actions", "approvals", "discounts"]) expect((await drill(kpi)).page.total).toBe(0); // no AI activity in the seed
  });

  it("pages, narrows by rep and territory, and keeps reps to their own records", async () => {
    const t = await seededKit();
    const all = ok(await handle(t.fnCtx("eleni", q("revenue"))));
    const p2 = ok(await handle(t.fnCtx("eleni", q("revenue", { page: 2, limit: 5 }))));
    expect(p2.page).toEqual({ page: 2, limit: 5, total: all.page.total });
    expect(p2.items).toEqual(all.items.slice(5, 10));
    const north = ok(await handle(t.fnCtx("eleni", q("at_risk", { territory_id: IDS.north }))));
    expect(north.items.every((i: any) => [IDS.nikos, IDS.dimitra].includes(i.owner_rep_id))).toBe(true);
    const mine = ok(await handle(t.fnCtx("nikos", q("revenue"))));
    expect(mine.items.every((i: any) => i.rep_id === IDS.nikos)).toBe(true);
    expect(errCode(await handle(t.fnCtx("nikos", q("revenue", { rep_id: IDS.dimitra }))))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("eleni", q("bogus"))))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx(null, q("revenue"))))).toBe("forbidden");
  });

  it("a spoofed caller is ignored; the tool path runs the same impl", async () => {
    const t = await seededKit();
    const base = ok(await handle(t.fnCtx("nikos", q("at_risk"))));
    expect(ok(await handle(t.fnCtx("nikos", { ...q("at_risk"), caller: IDS.thanasis })))).toEqual(base);
    expect(validateRequest("kpi-drilldown", { ...q("at_risk"), extra: 1 }).ok).toBe(false);
    expect(await runAsTool("kpi-drilldown", impl, t.toolCtx("nikos"), q("at_risk"), t.key)).toEqual(base);
  });

  it("functions/kpi-drilldown/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "kpi-drilldown", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("kpi-drilldown"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
