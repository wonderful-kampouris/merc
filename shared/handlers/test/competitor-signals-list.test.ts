import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, impl } from "../src/competitor-signals-list";

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

describe("fn:competitor-signals-list (REQ-DSH-006)", () => {
  it("shows 3 Aroma signals in the North, newest first, with names joined", async () => {
    const t = kit();
    const out = ok(await handle(t.fnCtx("eleni", { competitor_id: AROMA, territory_id: IDS.north })));
    expect(validateResponse("competitor-signals-list", out).ok).toBe(true);
    expect(out.page.total).toBe(3);
    expect(out.items.map((i: any) => i.competitor_name)).toEqual(["Aroma Delta", "Aroma Delta", "Aroma Delta"]);
    expect(out.items.every((i: any) => i.territory_name === "North")).toBe(true);
    const days = out.items.map((i: any) => i.observed_day);
    expect(days).toEqual([...days].sort().reverse());
    expect(out.items[0]).toMatchObject({ statement: "Aroma Delta offered 12% lower", price_delta_pct: -12, reported_by_name: "Dimitra Pappa", account_name: "Dasos Coffee" });
  });

  it("filters by competitor, territory and time; pages", async () => {
    const t = kit();
    expect(ok(await handle(t.fnCtx("eleni", {}))).page.total).toBe(4);
    expect(ok(await handle(t.fnCtx("eleni", { competitor_id: BLUEBEAN }))).items.map((i: any) => i.territory_id)).toEqual([IDS.center]);
    expect(ok(await handle(t.fnCtx("eleni", { territory_id: IDS.center }))).page.total).toBe(1);
    expect(ok(await handle(t.fnCtx("eleni", { from: "2026-11-12" }))).page.total).toBe(2); // D-3 and D-2
    const p = ok(await handle(t.fnCtx("eleni", { page: 2, limit: 3 })));
    expect(p.page).toEqual({ page: 2, limit: 3, total: 4 });
    expect(p.items).toHaveLength(1);
    expect(errCode(await handle(t.fnCtx("eleni", { from: "yesterday" })))).toBe("validation_failed");
  });

  it("is gated on team.read and scoped to the caller's org and team", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", {})))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx(null, {})))).toBe("forbidden");
    expect(ok(await handle(t.fnCtx("thanasis", {}))).page.total).toBe(4);
    // a signal on another org's account never shows
    await t.tables.insert("merc.competitor_signal", { account_id: "00000000-0000-4000-8000-000000000001", competitor_id: AROMA, reported_by: IDS.nikos, statement: "x", observed_at: "2026-11-15T10:00:00Z" }).catch(() => null);
    expect(ok(await handle(t.fnCtx("thanasis", {}))).page.total).toBe(4);
  });

  it("a spoofed caller is ignored; the tool path runs the same impl", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", { caller: IDS.eleni })))).toBe("forbidden");
    const base = ok(await handle(t.fnCtx("eleni", { competitor_id: AROMA })));
    expect(await runAsTool("competitor-signals-list", impl, t.toolCtx("eleni"), { competitor_id: AROMA }, t.key)).toEqual(base);
    expect(validateRequest("competitor-signals-list", { x: 1 }).ok).toBe(false);
  });

  it("functions/competitor-signals-list/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "competitor-signals-list", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("competitor-signals-list"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
