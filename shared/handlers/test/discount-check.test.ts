import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl, lineLimit, makeImpl } from "../src/discount-check";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const ESPRESSO = "120d56dc-215d-557d-bbab-43d87e1047c4"; // Coffee
const FLOUR = "13945850-a84e-5577-ade0-14a8f5a320e4"; // Bakery supplies
const ARTOS = "0610c44c-149d-5163-a097-65381aa877f7"; // Bakery, Nikos
const KOLONAKI = "4cfe45a4-9761-5595-adb2-c1af5a6f2329"; // Center, Maria
const NOW = Date.parse("2026-11-16T10:00:00Z"); // 12:00 Athens
const fakeApi = () => ({ calls: [] as unknown[], post: async (p: string, o?: unknown) => { void p; void o; return {}; } });

describe("fn:discount-check (REQ-DSC-001, metrics.md#discount-limit)", () => {
  it("3% for Nikos on coffee is allowed and logs a discount_within_limit AI action", async () => {
    const t = kit();
    const body = { account_id: IDS.miltos, discount_pct: 3, product_ids: [ESPRESSO] };
    expect(validateRequest("discount-check", body).ok).toBe(true);
    const r = ok(await handle(t.fnCtx("nikos", body)));
    expect(validateResponse("discount-check", r).ok).toBe(true);
    expect(r).toMatchObject({ allowed: true, limit_pct: 3, policy_id: "fb6c6bb9-1b34-5770-9250-0637213b1127", approver: null });
    const action = await t.db.ai_action.require(r.ai_action_id!);
    expect(action).toMatchObject({ action_type_code: "discount_within_limit", agent: "discount", status: "applied", on_behalf_of: IDS.nikos, target_id: IDS.miltos });
  });

  it("5% on bakery supplies to a bakery is allowed (category rule)", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { account_id: ARTOS, discount_pct: 5, product_ids: [FLOUR] })));
    expect(r).toMatchObject({ allowed: true, limit_pct: 5, policy_id: "730bf31a-9572-500c-ab95-124ee00e8156" });
  });

  it("8% is not allowed: Eleni is the approver, no AI action, no live call without caller id", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, discount_pct: 8, product_ids: [ESPRESSO] })));
    expect(r).toMatchObject({ allowed: false, limit_pct: 3, ai_action_id: null, manager_call_available: false, approver: { id: IDS.eleni, role: "manager" } });
    expect(await t.db.ai_action.count()).toBe(0);
  });

  it("manager_call_available once caller id + service account exist, inside call hours only", async () => {
    const t = kit({ globals: { MERC_APPROVER_CALLER_ID: "+12025550100" } });
    const body = { account_id: IDS.miltos, discount_pct: 8, product_ids: [ESPRESSO] };
    expect(ok(await defineFunction("discount-check", makeImpl({ api: fakeApi(), now: () => NOW }))(t.fnCtx("nikos", body))).manager_call_available).toBe(true);
    const late = Date.parse("2026-11-16T19:00:00Z"); // 21:00 Athens
    expect(ok(await defineFunction("discount-check", makeImpl({ api: fakeApi(), now: () => late }))(t.fnCtx("nikos", body))).manager_call_available).toBe(false);
  });

  it("a multi-line request is limited by its strictest line", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { account_id: ARTOS, discount_pct: 5, product_ids: [FLOUR, ESPRESSO] })));
    expect(r).toMatchObject({ allowed: false, limit_pct: 3 });
  });

  it("a user-specific policy beats role rules; no policy -> 0", () => {
    const base = { org_id: IDS.org, role_code: null, product_category_id: null, account_category_id: null, active: true } as const;
    const pols = [{ ...base, id: "a", role_code: "rep", max_discount_pct: 3 }, { ...base, id: "b", user_id: IDS.nikos, max_discount_pct: 7 }] as any;
    expect(lineLimit(pols, { id: IDS.nikos, role_code: "rep" }, null, null)).toMatchObject({ limit_pct: 7, rule: 1 });
    expect(lineLimit(pols, { id: IDS.dimitra, role_code: "rep" }, null, null)).toMatchObject({ limit_pct: 3, rule: 4 });
    expect(lineLimit([], { id: IDS.dimitra, role_code: "rep" }, null, null)).toMatchObject({ limit_pct: 0, policy_id: null });
  });

  it("errors: another territory's account forbidden, unknown product and bad % validation_failed, no user forbidden", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: KOLONAKI, discount_pct: 2, product_ids: [ESPRESSO] })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, discount_pct: 2, product_ids: [IDS.org] })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, discount_pct: 0, product_ids: [ESPRESSO] })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx(null, { account_id: IDS.miltos, discount_pct: 2, product_ids: [ESPRESSO] })))).toBe("forbidden");
  });

  it("ignores a spoofed caller; the buddy tool path runs the same impl", async () => {
    const t = kit();
    const body = { account_id: IDS.miltos, discount_pct: 8, product_ids: [ESPRESSO] };
    const viaFn = ok(await handle(t.fnCtx("nikos", { ...body, caller: { user_id: IDS.thanasis } })));
    expect(viaFn.limit_pct).toBe(3);
    expect(ok(await runAsTool("discount-check", impl, t.toolCtx("nikos"), body, t.key))).toEqual(viaFn);
  });

  it("functions/discount-check/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "discount-check", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("discount-check"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
