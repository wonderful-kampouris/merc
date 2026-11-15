import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { discountLimit, handle, impl, lineTotal } from "../src/order-upsert";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const ESPRESSO = "120d56dc-215d-557d-bbab-43d87e1047c4"; // Espresso Classico 1kg, kg, list 1890
const draft12kg = { account_id: IDS.miltos, status: "draft", lines: [{ product_id: ESPRESSO, quantity: 12 }] };

describe("fn:order-upsert (REQ-DEB-010)", () => {
  it("'put down 12 kilos' creates a draft at list price that stays a draft until confirmed", async () => {
    const t = kit();
    expect(validateRequest("order-upsert", draft12kg).ok).toBe(true);
    const r = ok(await handle(t.fnCtx("nikos", draft12kg)));
    expect(validateResponse("order-upsert", r).ok).toBe(true);
    expect(r.order).toMatchObject({ status: "draft", order_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), total_minor: 12 * 1890, lines: [{ product_id: ESPRESSO, name: "Espresso Classico 1kg", quantity: 12, unit: "kg" }] });
    const row = await t.db.sales_order.require(r.order.order_id);
    expect(row).toMatchObject({ status: "draft", rep_id: IDS.nikos, source: "manual", account_id: IDS.miltos });
    // editing the draft keeps it a draft and replaces the lines
    const e = ok(await handle(t.fnCtx("nikos", { ...draft12kg, order_id: row.id, lines: [{ product_id: ESPRESSO, quantity: 10 }] })));
    expect(e.order.status).toBe("draft");
    expect((await t.db.order_line.all({ order_id: row.id })).map((l) => l.quantity)).toEqual([10]);
    // explicit confirmation flips it
    const c = ok(await handle(t.fnCtx("nikos", { ...draft12kg, order_id: row.id, status: "confirmed", lines: [{ product_id: ESPRESSO, quantity: 10 }] })));
    expect(c.order).toMatchObject({ status: "confirmed", total_minor: 18900 });
  });

  it("a new order cannot skip the draft: confirmed -> needs_confirmation, cancelled -> validation_failed", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", { ...draft12kg, status: "confirmed" })))).toBe("needs_confirmation");
    expect(errCode(await handle(t.fnCtx("nikos", { ...draft12kg, status: "cancelled" })))).toBe("validation_failed");
    expect(await t.db.sales_order.count({ status: "draft" })).toBe(0);
  });

  it("transitions: confirmed is locked, cancelled is final, confirmed is idempotent", async () => {
    const t = kit();
    const id = ok(await handle(t.fnCtx("nikos", draft12kg))).order.order_id;
    ok(await handle(t.fnCtx("nikos", { ...draft12kg, order_id: id, status: "confirmed" })));
    expect(ok(await handle(t.fnCtx("nikos", { ...draft12kg, order_id: id, status: "confirmed" }))).order.status).toBe("confirmed");
    expect(ok(await handle(t.fnCtx("nikos", { ...draft12kg, order_id: id, status: "confirmed", lines: [] }))).order.lines).toHaveLength(1);
    expect(errCode(await handle(t.fnCtx("nikos", { ...draft12kg, order_id: id, status: "confirmed", lines: [{ product_id: ESPRESSO, quantity: 99 }] })))).toBe("conflict");
    expect(errCode(await handle(t.fnCtx("nikos", { ...draft12kg, order_id: id, status: "draft" })))).toBe("conflict");
    expect(ok(await handle(t.fnCtx("nikos", { ...draft12kg, order_id: id, status: "cancelled", lines: [] }))).order.status).toBe("cancelled");
    expect(errCode(await handle(t.fnCtx("nikos", { ...draft12kg, order_id: id, status: "draft" })))).toBe("conflict");
  });

  it("validates lines: empty, unknown product, quantity <= 0", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", { ...draft12kg, lines: [] })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { ...draft12kg, lines: [{ product_id: IDS.miltos, quantity: 1 }] })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { ...draft12kg, lines: [{ product_id: ESPRESSO, quantity: 0 }] })))).toBe("validation_failed");
  });

  it("discount above the rep limit is blocked_by_policy unless an approved discount_request covers it", async () => {
    const t = kit();
    const at = (pct: number) => ({ ...draft12kg, lines: [{ product_id: ESPRESSO, quantity: 12, discount_pct: pct }] });
    const r3 = ok(await handle(t.fnCtx("nikos", at(3)))); // rep default policy: 3%
    expect(r3.order.total_minor).toBe(lineTotal({ quantity: 12, unit_price_minor: 1890, discount_pct: 3 }));
    const b = await handle(t.fnCtx("nikos", at(8)));
    expect(errCode(b)).toBe("blocked_by_policy");
    expect((b as any).error.details).toMatchObject({ limit_pct: 3, discount_pct: 8 });
    // an approved request for 10% on this account by nikos unlocks it
    t.tables.load("approval", [{ id: "00000000-0000-4000-8000-0000000000a1", kind: "discount", requested_by: IDS.nikos, approver_id: IDS.eleni, mode: "async", status: "approved" }]);
    t.tables.load("discount_request", [{ id: "00000000-0000-4000-8000-0000000000d1", approval_id: "00000000-0000-4000-8000-0000000000a1", account_id: IDS.miltos, requested_pct: 10, policy_limit_pct: 3, approved_pct: 10 }]);
    expect(ok(await handle(t.fnCtx("nikos", at(8)))).order.status).toBe("draft");
    expect(errCode(await handle(t.fnCtx("nikos", at(12))))).toBe("blocked_by_policy");
    // a manager's own limit is 10%
    expect(errCode(await handle(t.fnCtx("eleni", at(10))))).toBeNull();
  });

  it("discountLimit follows metrics.md#discount-limit resolution order", () => {
    const base = { org_id: IDS.org, active: true, valid_from: null, valid_to: null };
    const pol = [
      { ...base, id: "p4", role_code: "rep", user_id: null, product_category_id: null, account_category_id: null, max_discount_pct: 3 },
      { ...base, id: "p3", role_code: "rep", user_id: null, product_category_id: "pc", account_category_id: null, max_discount_pct: 4 },
      { ...base, id: "p2", role_code: "rep", user_id: null, product_category_id: "pc", account_category_id: "ac", max_discount_pct: 5 },
      { ...base, id: "p1", role_code: null, user_id: "u1", product_category_id: null, account_category_id: null, max_discount_pct: 7 },
    ] as any[];
    expect(discountLimit(pol, { id: "u1", role: "rep" }, "pc", "ac").policy_id).toBe("p1");
    expect(discountLimit(pol, { id: "u2", role: "rep" }, "pc", "ac").limit_pct).toBe(5);
    expect(discountLimit(pol, { id: "u2", role: "rep" }, "pc", "zz").limit_pct).toBe(4);
    expect(discountLimit(pol, { id: "u2", role: "rep" }, "qq", "ac").limit_pct).toBe(3);
    expect(discountLimit(pol, { id: "u2", role: "manager" }, "pc", "ac")).toEqual({ limit_pct: 0, policy_id: null });
  });

  it("scope: other account forbidden; another rep cannot touch nikos's draft; a spoofed caller is ignored", async () => {
    const t = kit();
    const center = (await t.db.account.all({ territory_id: IDS.center }))[0]!;
    expect(errCode(await handle(t.fnCtx("nikos", { ...draft12kg, account_id: center.id })))).toBe("forbidden");
    const id = ok(await handle(t.fnCtx("nikos", { ...draft12kg, caller: { user_id: IDS.dimitra } }))).order.order_id;
    expect((await t.db.sales_order.require(id)).rep_id).toBe(IDS.nikos);
    expect(errCode(await handle(t.fnCtx("dimitra", { ...draft12kg, order_id: id, status: "confirmed" })))).toBe("forbidden");
    expect((await t.db.sales_order.require(id)).status).toBe("draft");
  });

  it("a failed line write leaves no half-written draft", async () => {
    const t = kit();
    const before = await t.db.sales_order.count();
    const realInsert = t.tables.insert.bind(t.tables);
    (t.tables as any).insert = async (q: string, d: any) => { if (q.endsWith(".order_line")) throw Object.assign(new Error("boom"), { status: 502 }); return realInsert(q, d); };
    expect(errCode(await handle(t.fnCtx("nikos", draft12kg)))).toBe("upstream_failed");
    expect(await t.db.sales_order.count()).toBe(before);
  });

  it("the buddy draft_order tool path runs the same impl", async () => {
    const t = kit();
    const v = ok(await runAsTool("order-upsert", impl, t.toolCtx("nikos"), draft12kg, t.key));
    expect(v.order.status).toBe("draft");
  });

  it("functions/order-upsert/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "order-upsert", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("order-upsert"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
