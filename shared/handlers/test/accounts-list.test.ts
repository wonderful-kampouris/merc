import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS, DEMO_DAY } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

import { handle, impl, normalizeName, AT_RISK_MIN_SCORE } from "../src/accounts-list";
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${DEMO_DAY}T08:00:00Z`)); });
afterEach(() => { vi.useRealTimers(); });
const AVRA = "ef86a932-3241-51c8-b7be-1df72dbf74f9";
const idOf = async (t: ReturnType<typeof kit>, name: string) => (await t.db.account.findOne({ name }))!.id;

describe("fn:accounts-list (REQ-CORE-009)", () => {
  it("rep sees owned + territory accounts only, paged, contract-valid", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", {})));
    expect(validateResponse("accounts-list", r).ok).toBe(true);
    const names = r.items.map((a) => a.name);
    expect(names).toContain("Café Miltos");
    expect(names).toContain("Pita & Psomi"); // Dimitra's, same North territory
    expect(names).not.toContain("Kolonaki Corner"); // Center
    expect(r.page).toEqual({ page: 1, limit: 50, total: r.items.length });
    expect(r.items.find((a) => a.name === "Café Miltos")!.city).toBe("Chalandri");
    const admin = ok(await handle(t.fnCtx("thanasis", {})));
    expect(admin.page.total).toBe(40);
  });

  it("filters: q (accent/Greek-insensitive), account_type, owner, paging", async () => {
    const t = kit();
    expect(ok(await handle(t.fnCtx("nikos", { q: "cafe" }))).items.map((a) => a.name)).toContain("Café Avra");
    expect(ok(await handle(t.fnCtx("nikos", { q: "Μίλτος" }))).items.map((a) => a.name)).toEqual(["Café Miltos"]);
    const prospects = ok(await handle(t.fnCtx("nikos", { account_type: "prospect" }))).items;
    expect(prospects.every((a) => a.account_type === "prospect")).toBe(true);
    expect(prospects.map((a) => a.name)).toContain("Café Avra");
    const dim = ok(await handle(t.fnCtx("nikos", { owner_id: IDS.dimitra }))).items;
    expect(dim.length).toBeGreaterThan(0);
    const p2 = ok(await handle(t.fnCtx("nikos", { page: "2", limit: "5" })));
    expect(p2.page.page).toBe(2);
    expect(p2.items.length).toBe(5);
    expect(normalizeName("Φούρνος Γωνιά")).toBe("fournos gonia");
  });

  it("at_risk uses account_metrics.risk_score >= threshold", async () => {
    const t = kit();
    await t.db.account_metrics.insert({ account_id: IDS.miltos, risk_score: AT_RISK_MIN_SCORE + 10, risk_reasons: "order_gap", computed_at: `${DEMO_DAY}T03:00:00.000Z` } as any);
    const r = ok(await handle(t.fnCtx("nikos", { at_risk: "true" })));
    expect(r.items.map((a) => a.id)).toEqual([IDS.miltos]);
    expect(r.items[0]!.reason).toContain("order_gap");
    expect(ok(await handle(t.fnCtx("nikos", { at_risk: false }))).items.map((a) => a.id)).not.toContain(IDS.miltos);
  });

  it("manager sees the team; spoofed caller is ignored; no user is forbidden; contract rejects stray params", async () => {
    const t = kit();
    expect(ok(await handle(t.fnCtx("eleni", {}))).items.map((a) => a.name)).toContain("Café Miltos");
    const spoof = ok(await handle(t.fnCtx("nikos", { caller: { user_id: IDS.thanasis, role: "admin" } })));
    expect(spoof.items.map((a) => a.name)).not.toContain("Kolonaki Corner");
    expect(errCode(await handle(t.fnCtx(null, {})))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { foo: 1 })))).toBe("validation_failed");
    expect(validateRequest("accounts-list", { q: "x", limit: 3 }).ok).toBe(true);
  });

  it("the tool path runs the same impl", async () => {
    const t = kit();
    expect(ok(await runAsTool("accounts-list", impl, t.toolCtx("nikos"), { q: "avra" }, t.key))).toEqual(ok(await handle(t.fnCtx("nikos", { q: "avra" }))));
  });

  it("functions/accounts-list/handler.gen.js is the current bundle (run `pnpm bundle accounts-list` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "accounts-list", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("accounts-list"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
