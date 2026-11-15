import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, impl } from "../src/team-list";

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

describe("fn:team-list", () => {
  it("a manager gets her reports with territories, sorted by name", async () => {
    const t = kit();
    const out = ok(await handle(t.fnCtx("eleni", {})));
    expect(validateResponse("team-list", out).ok).toBe(true);
    expect(out.items.map((i) => i.user.full_name)).toEqual(["Dimitra Pappa", "Giorgos Lazarou", "Maria Ioannou", "Nikos Alexiou"]);
    expect(out.items.find((i) => i.user.id === IDS.nikos)).toEqual({ user: { id: IDS.nikos, full_name: "Nikos Alexiou", role: "rep" }, manager_id: IDS.eleni, territory_ids: [IDS.north], status: "active" });
    expect(out.items.find((i) => i.user.id === MARIA)!.territory_ids).toEqual([IDS.center]);
  });

  it("inactive users only on request; admin sees everyone; reps are refused", async () => {
    const t = kit();
    await t.db.app_user.update(GIORGOS, { status: "left" });
    expect(ok(await handle(t.fnCtx("eleni", {}))).items.map((i) => i.user.id)).not.toContain(GIORGOS);
    const all = ok(await handle(t.fnCtx("eleni", { include_inactive: true })));
    expect(all.items.find((i) => i.user.id === GIORGOS)!.status).toBe("left");
    const admin = ok(await handle(t.fnCtx("thanasis", {})));
    expect(admin.items.map((i) => i.user.role).sort()).toEqual(["admin", "manager", "rep", "rep", "rep"]);
    expect(errCode(await handle(t.fnCtx("nikos", {})))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx(null, {})))).toBe("forbidden");
  });

  it("a spoofed caller is ignored; the tool path runs the same impl", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", { caller: IDS.thanasis })))).toBe("forbidden");
    const base = ok(await handle(t.fnCtx("eleni", {})));
    expect(await runAsTool("team-list", impl, t.toolCtx("eleni"), {}, t.key)).toEqual(base);
    expect(validateRequest("team-list", { x: 1 }).ok).toBe(false);
  });

  it("functions/team-list/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "team-list", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("team-list"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
