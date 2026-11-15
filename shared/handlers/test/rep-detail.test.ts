import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { makeImpl } from "../src/rep-detail";
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
const handle = defineFunction("rep-detail", impl);
const q = { rep_id: IDS.nikos, from: "2026-11-03", to: "2026-11-16" };

describe("fn:rep-detail (REQ-DSH-003)", () => {
  it("Eleni opens Nikos's detail: activity, logging discipline, pipeline and alerts", async () => {
    const t = await seededKit();
    const alert = await t.db.alert.insert({ alert_type_code: "going_quiet", recipient_id: IDS.nikos, account_id: IDS.miltos, severity: "high", status: "open", dedupe_key: "test:dsh:1", message: "Café Miltos is going quiet" });
    const voice = await t.db.voice_log.insert({ rep_id: IDS.nikos, account_id: IDS.miltos, capture_mode: "live_buddy", status: "completed", idempotency_key: "dsh-test-1", recorded_at: "2026-11-16T07:30:00Z", transcript: "secret words of the rep" });
    const out = ok(await handle(t.fnCtx("eleni", q)));
    expect(validateResponse("rep-detail", out).ok).toBe(true);
    expect(out.rep).toEqual({ id: IDS.nikos, full_name: "Nikos Alexiou", role: "rep" });
    const dash = ok(await defineFunction("dashboard-kpis", dashboard({ now: () => NOW }))(t.fnCtx("eleni", { scope: "team", rep_id: IDS.nikos, from: q.from, to: q.to })));
    expect(out.kpis).toMatchObject(dash.by_rep[0]!.kpis);
    expect(out.kpis).toMatchObject({ voice_logs: 1, open_alerts: 1 });
    expect(out.kpis.visits_done).toBeGreaterThan(0);
    expect(out.kpis.visits_without_log).toBe(out.kpis.visits_done);
    expect(out.recent_visits.length).toBeGreaterThan(0);
    expect(out.recent_visits.every((v) => v.planned_date >= q.from && v.planned_date <= q.to)).toBe(true);
    expect(out.open_alerts.map((a) => a.alert_id)).toEqual([alert.id]);
    // OPEN-13: results, never transcripts
    expect(out.recent_debriefs).toHaveLength(1);
    expect(out.recent_debriefs[0]).toMatchObject({ voice_log_id: voice.id, status: "completed", transcript_visible: false });
    expect(JSON.stringify(out)).not.toContain("secret words");
  });

  it("only the rep's manager (or an admin) may open it", async () => {
    const t = await seededKit();
    expect(ok(await handle(t.fnCtx("thanasis", q))).rep.id).toBe(IDS.nikos);
    expect(errCode(await handle(t.fnCtx("nikos", q)))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("dimitra", q)))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("eleni", { ...q, rep_id: IDS.thanasis })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx(null, q)))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("eleni", { ...q, from: "2026-11-20" })))).toBe("validation_failed");
  });

  it("a spoofed caller is ignored; the tool path runs the same impl", async () => {
    const t = await seededKit();
    expect(errCode(await handle(t.fnCtx("nikos", { ...q, caller: IDS.eleni })))).toBe("forbidden");
    const base = ok(await handle(t.fnCtx("eleni", q)));
    expect(await runAsTool("rep-detail", impl, t.toolCtx("eleni"), q, t.key)).toEqual(base);
    expect(validateRequest("rep-detail", { ...q, x: 1 }).ok).toBe(false);
  });

  it("functions/rep-detail/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "rep-detail", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("rep-detail"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
