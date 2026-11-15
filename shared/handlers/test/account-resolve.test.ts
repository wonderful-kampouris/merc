import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS, DEMO_DAY } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

import { handle, impl, nameScore, haversineM } from "../src/account-resolve";
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${DEMO_DAY}T08:00:00Z`)); });
afterEach(() => { vi.useRealTimers(); });
const AVRA = "ef86a932-3241-51c8-b7be-1df72dbf74f9";
const idOf = async (t: ReturnType<typeof kit>, name: string) => (await t.db.account.findOne({ name }))!.id;

const MILTOS_AT = { lat: 38.022715, lng: 23.7947 };
describe("fn:account-resolve (REQ-CRD-003)", () => {
  it("\"I'm at Miltos\" resolves (English and Greek)", async () => {
    const t = kit();
    for (const hint of ["Miltos", "I'm at Miltos", "Μίλτος", "είμαι στο Μίλτος", "Miltso"]) {
      const r = ok(await handle(t.fnCtx("nikos", { hint })));
      expect(validateResponse("account-resolve", r).ok).toBe(true);
      expect([hint, r.status, r.account?.id]).toEqual([hint, "resolved", IDS.miltos]);
    }
  });

  it("\"the café\" with 2 matches (both visited today) is ambiguous so the buddy asks", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { hint: "the café" })));
    expect(r.status).toBe("ambiguous");
    expect(r.account).toBeNull();
    expect(r.candidates.map((c) => c.name).sort()).toEqual(["Café Avra", "Café Miltos"]);
    expect(r.candidates.every((c) => c.reason === "name match, visit today")).toBe(true);
    expect(ok(await handle(t.fnCtx("nikos", { hint: "το καφέ" }))).status).toBe("ambiguous");
  });

  it("today's visits break a name tie; location breaks the rest", async () => {
    const t = kit();
    const g = ok(await handle(t.fnCtx("nikos", { hint: "Gonia" }))); // Fournos Gonia (visit today) vs Glykia Gonia Bakery
    expect([g.status, g.account?.name]).toEqual(["resolved", "Fournos Gonia"]);
    const near = ok(await handle(t.fnCtx("nikos", { hint: "the café", lat: String(MILTOS_AT.lat), lng: String(MILTOS_AT.lng) })));
    expect([near.status, near.account?.id]).toEqual(["resolved", IDS.miltos]);
    expect(near.account!.distance_m).toBe(0);
  });

  it("no hint: nearest clear match, else today's visits to choose from", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { lat: 38.026992, lng: 23.804814 })));
    expect([r.status, r.account?.name]).toEqual(["resolved", "Café Avra"]);
    const none = ok(await handle(t.fnCtx("nikos", {})));
    expect(none.status).toBe("ambiguous");
    expect(none.candidates.length).toBeGreaterThanOrEqual(2);
    const far = ok(await handle(t.fnCtx("dimitra", { lat: 35.0, lng: 25.0 })));
    expect(far.status).toBe("not_found");
  });

  it("scope: names outside the caller's territory are not found (app and voice); spoofed caller ignored", async () => {
    const t = kit();
    expect(ok(await handle(t.fnCtx("nikos", { hint: "Kolonaki Corner" }))).status).toBe("not_found");
    expect(ok(await handle(t.fnCtx("nikos", { hint: "Kolonaki Corner", caller: { user_id: IDS.thanasis, role: "admin" } }))).status).toBe("not_found");
    expect(ok(await runAsTool("account-resolve", impl, t.toolCtx("nikos"), { hint: "Kolonaki" }, t.key)).status).toBe("not_found");
    expect(ok(await handle(t.fnCtx("thanasis", { hint: "Kolonaki Corner" }))).status).toBe("resolved");
    expect(ok(await runAsTool("account-resolve", impl, t.toolCtx("nikos"), { hint: "Miltos" }, t.key))).toEqual(ok(await handle(t.fnCtx("nikos", { hint: "Miltos" }))));
    expect(ok(await handle(t.fnCtx("nikos", { hint: "zzzz" }))).status).toBe("not_found");
  });

  it("helpers", () => {
    expect(nameScore("Café Miltos", "Café Miltos")).toBe(4);
    expect(nameScore("milt", "Café Miltos")).toBe(2);
    expect(nameScore("the", "Café Miltos")).toBe(0);
    expect(Math.round(haversineM(38, 23, 38.001, 23))).toBe(111);
  });

  it("functions/account-resolve/handler.gen.js is the current bundle (run `pnpm bundle account-resolve` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "account-resolve", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("account-resolve"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
