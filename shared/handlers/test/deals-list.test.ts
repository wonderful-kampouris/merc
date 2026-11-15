import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl, paging } from "../src/deals-list";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

describe("fn:deals-list", () => {
  it("a rep sees the deals of visible accounts with stage + names; response matches the contract", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { limit: 200 })));
    expect(validateResponse("deals-list", r).ok).toBe(true);
    expect(r.items.length).toBeGreaterThan(0);
    const espresso = r.items.find((d: any) => d.title === "Espresso 20kg monthly") as any;
    expect(espresso).toMatchObject({ account_id: IDS.miltos, account_name: "Café Miltos", stage_code: "negotiation", stage_name: "Negotiation", probability: 0.7, owner_id: IDS.nikos });
    expect(espresso.weighted_minor).toBe(Math.round(380000 * 0.7));
    const visible = new Set((await t.db.account.all({ territory_id: IDS.north })).map((a) => a.id));
    for (const d of r.items as any[]) expect(visible.has(d.account_id) || d.owner_id === IDS.nikos).toBe(true);
    expect(r.page).toEqual({ page: 1, limit: 200, total: r.items.length });
  });

  it("filters by stage, account and owner; pages are 1-based", async () => {
    const t = kit();
    const neg = ok(await handle(t.fnCtx("eleni", { stage_code: "proposal" })));
    expect(neg.items.every((d: any) => d.stage_code === "proposal")).toBe(true);
    const one = ok(await handle(t.fnCtx("nikos", { account_id: IDS.miltos })));
    expect(one.items.every((d: any) => d.account_id === IDS.miltos)).toBe(true);
    const all = ok(await handle(t.fnCtx("thanasis", { limit: 500 })));
    const p2 = ok(await handle(t.fnCtx("thanasis", { page: 2, limit: 5 })));
    expect(p2.items.map((d: any) => d.id)).toEqual(all.items.slice(5, 10).map((d: any) => d.id));
    expect(p2.page.total).toBe(all.page.total);
    expect(paging({ page: 0, limit: 10_000 })).toEqual({ page: 1, limit: 500, offset: 0 });
  });

  it("GET query strings are coerced by the contract (page/limit as strings)", async () => {
    expect(validateRequest("deals-list", { page: "2", limit: "5" }, { coerce: true }).ok).toBe(true);
    const t = kit();
    expect(ok(await handle(t.fnCtx("nikos", { page: "1", limit: "3" }))).items.length).toBeLessThanOrEqual(3);
  });

  it("an account outside the rep's scope -> forbidden; no user -> forbidden (REQ-CORE-009)", async () => {
    const t = kit();
    const center = (await t.db.account.all({ territory_id: IDS.center }))[0]!;
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: center.id })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx(null)))).toBe("forbidden");
    const r = ok(await handle(t.fnCtx("nikos", { limit: 500 })));
    expect(r.items.some((d: any) => d.account_id === center.id)).toBe(false);
  });

  it("the tool path runs the same impl", async () => {
    const t = kit();
    expect(ok(await runAsTool("deals-list", impl, t.toolCtx("nikos"), { limit: 10 }, t.key))).toEqual(ok(await handle(t.fnCtx("nikos", { limit: 10 }))));
  });

  it("functions/deals-list/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "deals-list", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("deals-list"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
