import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateResponse } from "../../core/src/index";
import { handle, impl } from "../src/orders-list";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

describe("fn:orders-list", () => {
  it("orders of an account, newest first, as OrderSummary with line names and totals", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, limit: 5 })));
    expect(validateResponse("orders-list", r).ok).toBe(true);
    expect(r.items).toHaveLength(5);
    const dates = r.items.map((o) => o.order_date);
    expect([...dates].sort().reverse()).toEqual(dates);
    const first = r.items[0]!;
    const lines = await t.db.order_line.all({ order_id: first.order_id });
    expect(first.total_minor).toBe(lines.reduce((s, l) => s + Math.round(l.quantity * l.unit_price_minor * (1 - (l.discount_pct ?? 0) / 100)), 0));
    expect(first.lines.every((l) => l.name && l.unit)).toBe(true);
    expect(r.page.total).toBe(await t.db.sales_order.count({ account_id: IDS.miltos }));
  });

  it("from/to are inclusive order_date bounds; rep_id filters", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("eleni", { from: "2026-11-01", to: "2026-11-10", limit: 500 })));
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((o) => o.order_date >= "2026-11-01" && o.order_date <= "2026-11-10")).toBe(true);
    const mine = ok(await handle(t.fnCtx("eleni", { rep_id: IDS.nikos, limit: 500 })));
    const ids = new Set(mine.items.map((o) => o.order_id));
    for (const o of await t.db.sales_order.all({ id: [...ids] })) expect(o.rep_id).toBe(IDS.nikos);
    expect(ids.size).toBeGreaterThan(0);
  });

  it("scope: a rep never sees out-of-scope accounts; an explicit one is forbidden", async () => {
    const t = kit();
    const center = (await t.db.account.all({ territory_id: IDS.center })).map((a) => a.id);
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: center[0] })))).toBe("forbidden");
    const r = ok(await handle(t.fnCtx("nikos", { limit: 500 })));
    const accOf = new Map((await t.db.sales_order.all()).map((o) => [o.id, o.account_id]));
    expect(r.items.some((o) => center.includes(accOf.get(o.order_id)!))).toBe(false);
  });

  it("the tool path runs the same impl", async () => {
    const t = kit();
    expect(ok(await runAsTool("orders-list", impl, t.toolCtx("nikos"), { account_id: IDS.miltos }, t.key))).toEqual(ok(await handle(t.fnCtx("nikos", { account_id: IDS.miltos }))));
  });

  it("functions/orders-list/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "orders-list", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("orders-list"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
