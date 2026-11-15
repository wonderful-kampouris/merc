import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS, DEMO_DAY } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

import { handle, impl } from "../src/contact-upsert";
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${DEMO_DAY}T08:00:00Z`)); });
afterEach(() => { vi.useRealTimers(); });
const AVRA = "ef86a932-3241-51c8-b7be-1df72dbf74f9";
const idOf = async (t: ReturnType<typeof kit>, name: string) => (await t.db.account.findOne({ name }))!.id;

const MILTOS_CONTACT = "416bbb0b-46bb-5b8d-be2c-d5cc354b6142";
const AVRA_CONTACT = "0fa4da7f-79d2-5ed7-8637-178952e3a08a";
describe("fn:contact-upsert (REQ-CORE-009)", () => {
  it("creates a contact on a visible account and edits an existing one", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { account_id: AVRA, fields: { full_name: "Maria Avra", role_title: "Manager", preferred_channel: "viber" } })));
    expect(validateResponse("contact-upsert", r).ok).toBe(true);
    expect(await t.db.contact.get(r.contact_id)).toMatchObject({ account_id: AVRA, full_name: "Maria Avra", is_decision_maker: false, preferred_channel: "viber" });
    expect(ok(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, contact_id: MILTOS_CONTACT, fields: { phone: "+306909999999" } }))).contact_id).toBe(MILTOS_CONTACT);
    expect((await t.db.contact.get(MILTOS_CONTACT))!.phone).toBe("+306909999999");
  });

  it("rejects bad input: missing name, unknown field, bad enum, contact of another account", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: AVRA, fields: { role_title: "x" } })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: AVRA, fields: { full_name: "A", account_id: IDS.miltos } })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: AVRA, fields: { full_name: "A", preferred_channel: "fax" } })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, contact_id: AVRA_CONTACT, fields: { phone: "1" } })))).toBe("validation_failed");
  });

  it("scope: another territory's account is forbidden, by app and by voice; spoofed caller ignored", async () => {
    const t = kit();
    const kol = await idOf(t, "Kolonaki Corner");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: kol, fields: { full_name: "Z" } })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: kol, fields: { full_name: "Z" }, caller: { user_id: IDS.thanasis } })))).toBe("forbidden");
    expect(errCode(await runAsTool("contact-upsert", impl, t.toolCtx("nikos"), { account_id: kol, fields: { full_name: "Z" } }, t.key))).toBe("forbidden");
    expect(ok(await runAsTool("contact-upsert", impl, t.toolCtx("nikos"), { account_id: AVRA, fields: { full_name: "Via Voice" } }, t.key)).contact_id).toBeTruthy();
  });

  it("functions/contact-upsert/handler.gen.js is the current bundle (run `pnpm bundle contact-upsert` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "contact-upsert", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("contact-upsert"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
