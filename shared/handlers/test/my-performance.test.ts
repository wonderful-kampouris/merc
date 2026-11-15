import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { localDate, runAsTool, validateResponse } from "../../core/src/index";
import { handle, impl, makeImpl, lineTotalMinor } from "../src/my-performance";
import { kit, ok, errCode, IDS, DEMO_DAY } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const NOW = Date.parse(`${DEMO_DAY}T10:00:00Z`);
const h = makeImpl({ now: () => NOW });
const REV_TARGET = "df8b5251-0f66-5a22-8012-06619f78afaf", VISIT_TARGET = "a9aaac32-e868-50ce-b2cb-e0b784ab9aa0";

/** Hand query over the raw seed rows (no handler code), metrics.md#target-progress for nikos. */
function handActuals(t: ReturnType<typeof kit>, from: string, to: string) {
  const rows = (tbl: string): Record<string, any>[] => [...(t.tables.rows.get(tbl as never)?.values() ?? [])];
  const orders = rows("sales_order").filter((o) => o.rep_id === IDS.nikos && o.status === "confirmed" && o.order_date >= from && o.order_date <= to);
  const ids = new Set(orders.map((o) => o.id));
  const lines = rows("order_line").filter((l) => ids.has(l.order_id));
  const revenue = lines.reduce((s, l) => s + Math.round(l.quantity * l.unit_price_minor * (1 - (l.discount_pct ?? 0) / 100)), 0);
  const visits = rows("visit").filter((v) => v.rep_id === IDS.nikos && v.status === "done").filter((v) => { const d = v.completed_at ? localDate("Europe/Athens", v.completed_at) : v.planned_date; return d >= from && d <= to; }).length;
  const newc = rows("account").filter((a) => a.owner_rep_id === IDS.nikos && a.customer_since && a.customer_since >= from && a.customer_since <= to).length;
  return { revenue, visits, newc };
}

describe("fn:my-performance (REQ-TGT-002)", () => {
  it('"How am I doing this month?" -> pct and days left from the query (metrics.md#target-progress)', async () => {
    const t = kit();
    const r = ok(await runAsTool("my-performance", h, t.toolCtx("nikos"), { period: "month" }, t.key));
    expect(validateResponse("my-performance", r).ok).toBe(true);
    const hand = handActuals(t, "2026-11-01", "2026-11-30");
    expect(r.targets.map((x) => x.target_id).sort()).toEqual([REV_TARGET, VISIT_TARGET].sort());
    const rev = r.targets.find((x) => x.metric === "revenue")!, vis = r.targets.find((x) => x.metric === "visits")!;
    expect(rev).toMatchObject({ period_start: "2026-11-01", period_end: "2026-11-30", target_value: 1800000, actual_value: hand.revenue, days_left: 14 });
    expect(rev.pct).toBe(Math.round((1000 * hand.revenue) / 1800000) / 10);
    expect(vis).toMatchObject({ target_value: 110, actual_value: hand.visits, days_left: 14 });
    expect(hand.revenue).toBeGreaterThan(0);
    expect(r.revenue_minor).toBe(hand.revenue);
    expect(r.visits_done).toBe(hand.visits);
    expect(r.new_customers).toBe(hand.newc);
    // Spoken summary is built only from those numbers (Greek is the default language).
    expect(r.spoken_summary).toContain(`${rev.pct}%`);
    expect(r.spoken_summary).toContain("μένουν 14 μέρες");
    expect(r.spoken_summary).toContain((hand.revenue / 100).toFixed(2));
  });

  it("week and custom periods; targets keep their own period; custom needs from/to", async () => {
    const t = kit();
    const w = ok(await runAsTool("my-performance", h, t.toolCtx("nikos"), { period: "week" }, t.key));
    const hw = handActuals(t, "2026-11-16", "2026-11-22");
    expect(w.revenue_minor).toBe(hw.revenue);
    expect(w.visits_done).toBe(hw.visits);
    expect(w.targets.find((x) => x.metric === "revenue")!.actual_value).toBe(handActuals(t, "2026-11-01", "2026-11-30").revenue);
    const c = ok(await runAsTool("my-performance", h, t.toolCtx("nikos"), { period: "custom", from: "2026-10-01", to: "2026-10-31" }, t.key));
    expect(c.targets).toEqual([]);
    expect(c.revenue_minor).toBe(handActuals(t, "2026-10-01", "2026-10-31").revenue);
    expect(errCode(await runAsTool("my-performance", h, t.toolCtx("nikos"), { period: "custom" }, t.key))).toBe("validation_failed");
    expect(errCode(await runAsTool("my-performance", h, t.toolCtx("nikos"), { period: "custom", from: "2026-11-10", to: "2026-11-01" }, t.key))).toBe("validation_failed");
    expect(errCode(await runAsTool("my-performance", h, t.toolCtx("nikos"), { period: "year" }, t.key))).toBe("validation_failed");
  });

  it("only the caller's own numbers: a spoofed caller is ignored; a user without targets gets none", async () => {
    const t = kit();
    const asDimitra = ok(await handle(t.fnCtx("dimitra", { period: "month", caller: { user_id: IDS.nikos } })));
    expect(asDimitra.targets).toEqual([]);
    expect(errCode(await handle(t.fnCtx(null, { period: "month" })))).toBe("forbidden");
    const eleni = ok(await runAsTool("my-performance", h, t.toolCtx("eleni"), { period: "month" }, t.key));
    expect(eleni.targets).toEqual([]);
    expect(eleni.spoken_summary).toContain("Δεν υπάρχουν στόχοι");
  });

  it("English summary for an English-speaking user; revenue line formula", async () => {
    const t = kit();
    await t.db.app_user.update(IDS.nikos, { preferred_language: "en" });
    const r = ok(await runAsTool("my-performance", h, t.toolCtx("nikos"), { period: "month" }, t.key));
    expect(r.spoken_summary).toMatch(/^This month: revenue .* of 18000\.00 EUR \(.*%\), 14 days left\./);
    expect(lineTotalMinor({ quantity: 3, unit_price_minor: 1000, discount_pct: 10 })).toBe(2700);
  });

  it("deployed entry equals the tool path", async () => {
    const t = kit();
    expect(await runAsTool("my-performance", impl, t.toolCtx("nikos"), { period: "month" }, t.key)).toEqual(ok(await handle(t.fnCtx("nikos", { period: "month" }))));
  });

  it("functions/my-performance/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "my-performance", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("my-performance"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
