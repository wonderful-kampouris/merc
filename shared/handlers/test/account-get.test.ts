import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS, DEMO_DAY } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

import { handle, impl } from "../src/account-get";
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${DEMO_DAY}T08:00:00Z`)); });
afterEach(() => { vi.useRealTimers(); });
const AVRA = "ef86a932-3241-51c8-b7be-1df72dbf74f9";
const idOf = async (t: ReturnType<typeof kit>, name: string) => (await t.db.account.findOne({ name }))!.id;

describe("fn:account-get (REQ-CORE-009)", () => {
  it("returns the account with contacts, deals and activities", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { account_id: IDS.miltos })));
    expect(validateResponse("account-get", r).ok).toBe(true);
    expect(r.account.name).toBe("Café Miltos");
    expect(r.contacts.map((c: any) => c.full_name)).toContain("Miltos Papadakis");
    expect(r.contacts.every((c: any) => c.account_id === IDS.miltos)).toBe(true);
    expect(Array.isArray(r.deals) && Array.isArray(r.activities)).toBe(true);
  });

  it("rep B cannot read an account outside a shared territory (app and voice)", async () => {
    const t = kit();
    const kol = await idOf(t, "Kolonaki Corner");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: kol })))).toBe("forbidden");
    expect(errCode(await runAsTool("account-get", impl, t.toolCtx("nikos"), { account_id: kol }, t.key))).toBe("forbidden");
    expect(ok(await handle(t.fnCtx("thanasis", { account_id: kol }))).account.id).toBe(kol);
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: "00000000-0000-4000-8000-000000000000" })))).toBe("not_found");
    expect(errCode(await handle(t.fnCtx("nikos", {})))).toBe("validation_failed");
  });

  it("spoofed caller ignored; tool path equals app path", async () => {
    const t = kit();
    const kol = await idOf(t, "Kolonaki Corner");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: kol, caller: { user_id: IDS.thanasis } })))).toBe("forbidden");
    expect(ok(await runAsTool("account-get", impl, t.toolCtx("dimitra"), { account_id: AVRA }, t.key))).toEqual(ok(await handle(t.fnCtx("dimitra", { account_id: AVRA }))));
  });

  it("functions/account-get/handler.gen.js is the current bundle (run `pnpm bundle account-get` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "account-get", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("account-get"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
