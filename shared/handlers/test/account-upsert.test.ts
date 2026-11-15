import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS, DEMO_DAY } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

import { handle, impl } from "../src/account-upsert";
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${DEMO_DAY}T08:00:00Z`)); });
afterEach(() => { vi.useRealTimers(); });
const AVRA = "ef86a932-3241-51c8-b7be-1df72dbf74f9";
const idOf = async (t: ReturnType<typeof kit>, name: string) => (await t.db.account.findOne({ name }))!.id;

describe("fn:account-upsert (REQ-CORE-009)", () => {
  it("creates a prospect owned by the rep, territory from the postal code", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { fields: { name: " Kafe Test ", postal_code: "15231", phone: "+30210000000" } })));
    expect(validateResponse("account-upsert", r).ok).toBe(true);
    const a = (await t.db.account.get(r.account_id))!;
    expect(a).toMatchObject({ name: "Kafe Test", account_type: "prospect", owner_rep_id: IDS.nikos, territory_id: IDS.north, source: "manual", org_id: IDS.org });
    expect(r.audit).toContain("created");
  });

  it("edits allowed fields and reports what changed; no-op returns audit null", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, fields: { phone: "+302101112223", website: "https://miltos.example" } })));
    expect(r).toEqual({ account_id: IDS.miltos, audit: "updated phone, website" });
    expect((await t.db.account.get(IDS.miltos))!.phone).toBe("+302101112223");
    expect(ok(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, fields: { phone: "+302101112223" } }))).audit).toBeNull();
  });

  it("account_type changes go through account-convert; unknown fields and bad values are rejected", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: AVRA, fields: { account_type: "customer" } })))).toBe("validation_failed");
    expect(ok(await handle(t.fnCtx("nikos", { account_id: AVRA, fields: { account_type: "prospect", street: "Main 1" } }))).audit).toBe("updated street");
    expect(errCode(await handle(t.fnCtx("nikos", { fields: { name: "X", account_type: "customer" } })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, fields: { owner_rep_id: IDS.dimitra } })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, fields: { org_id: IDS.org } })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, fields: { lat: "north" } })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { fields: { phone: "1" } })))).toBe("validation_failed");
    expect((await t.db.account.get(AVRA))!.account_type).toBe("prospect");
  });

  it("scope: another territory's account or territory is forbidden; spoofed caller ignored", async () => {
    const t = kit();
    const kol = await idOf(t, "Kolonaki Corner");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: kol, fields: { phone: "1" } })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, fields: { territory_id: IDS.center } })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { fields: { name: "Y", owner_rep_id: IDS.center_rep } })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: kol, fields: { phone: "1" }, caller: { user_id: IDS.thanasis, role: "admin" } })))).toBe("forbidden");
    expect(ok(await handle(t.fnCtx("thanasis", { account_id: kol, fields: { phone: "+30210" } }))).audit).toBe("updated phone");
  });

  it("the tool path runs the same impl", async () => {
    const t = kit();
    const r = ok(await runAsTool("account-upsert", impl, t.toolCtx("nikos"), { account_id: IDS.miltos, fields: { email: "new@miltos.example.gr" } }, t.key));
    expect(r).toEqual({ account_id: IDS.miltos, audit: "updated email" });
  });

  it("functions/account-upsert/handler.gen.js is the current bundle (run `pnpm bundle account-upsert` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "account-upsert", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("account-upsert"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
