import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsTool, validateResponse } from "../../core/src/index";
import { makeImpl } from "../src/visit-update";
import { kit, ok, errCode, IDS, type Kit } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const NOW = Date.parse("2026-11-16T06:00:00Z"); // Monday 08:00 Athens
const appImpl = makeImpl("app", { now: () => NOW });
const buddyImpl = makeImpl("buddy", { now: () => NOW });
const handle = defineFunction("visit-update", appImpl);
const acc = async (t: Kit, name: string) => (await t.db.account.findOne({ name }))!.id;
const day = async (t: Kit, date: string) =>
  (await t.db.visit.all({ rep_id: IDS.nikos, planned_date: date, status: ["planned", "done"] })).sort((a, b) => (a.route_position ?? 99) - (b.route_position ?? 99));

describe("fn:visit-update (REQ-PLN-003)", () => {
  it("'Move Lofos to Friday' by voice moves the visit and logs a moved change via buddy", async () => {
    const t = kit();
    const lofos = await acc(t, "Bistro Lofos");
    const r = ok(await runAsTool("visit-update", buddyImpl, t.toolCtx("nikos"), { action: "move", account_id: lofos, date: "2026-11-20", reason: "Owner is away until Friday" }, t.key));
    expect(validateResponse("visit-update", r).ok).toBe(true);
    expect(r.visit).toMatchObject({ planned_date: "2026-11-20", status: "planned", route_position: 1 });
    expect(r.day_count).toBe(1);
    expect(r.warning ?? null).toBeNull();
    const changes = await t.db.visit_change.all({ visit_id: r.visit.visit_id });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ change_type: "moved", via: "buddy", from_date: "2026-11-16", to_date: "2026-11-20", reason: "Owner is away until Friday", changed_by: IDS.nikos });
    expect((await day(t, "2026-11-16")).map((v) => v.route_position)).toEqual([1, 2, 3, 4]); // old day renumbered
  });

  it("skip records the reason via app and frees the slot", async () => {
    const t = kit();
    const monday = await day(t, "2026-11-16");
    const r = ok(await handle(t.fnCtx("nikos", { action: "skip", visit_id: monday[0]!.id, reason: "Closed for inventory" })));
    expect(r.visit).toMatchObject({ status: "skipped", reason: "Closed for inventory" });
    expect(r.day_count).toBe(4);
    expect((await t.db.visit_change.all({ visit_id: monday[0]!.id }))[0]).toMatchObject({ change_type: "skipped", via: "app", reason: "Closed for inventory" });
  });

  it("add logs an added change; exceeding visits_per_day (6) still saves but warns", async () => {
    const t = kit();
    const first = ok(await handle(t.fnCtx("nikos", { action: "add", account_id: await acc(t, "Artos Chalandriou"), date: "2026-11-16", reason: "Late delivery follow-up" })));
    expect(first).toMatchObject({ day_count: 6, warning: null });
    expect(first.visit.route_position).toBe(6);
    const second = ok(await handle(t.fnCtx("nikos", { action: "add", account_id: await acc(t, "Zymi Bakery"), date: "2026-11-16", position: 1 })));
    expect(second.day_count).toBe(7);
    expect(second.warning).toMatch(/7 visits, above the daily cap of 6/);
    expect(second.visit.route_position).toBe(1);
    const added = await t.db.visit.require(second.visit.visit_id);
    expect(added).toMatchObject({ origin: "manual", plan_id: "0f5b2530-97ba-5d74-9cc4-241c48aeae04" });
    expect((await t.db.visit_change.all({ visit_id: added.id }))[0]).toMatchObject({ change_type: "added", via: "app", to_date: "2026-11-16" });
    expect((await day(t, "2026-11-16")).map((v) => v.route_position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("add by voice is origin buddy", async () => {
    const t = kit();
    const r = ok(await runAsTool("visit-update", buddyImpl, t.toolCtx("nikos"), { action: "add", account_id: await acc(t, "Zymi Bakery"), date: "2026-11-19" }, t.key));
    expect((await t.db.visit.require(r.visit.visit_id)).origin).toBe("buddy");
  });

  it("reorder moves a stop and renumbers the day, logging a reordered change", async () => {
    const t = kit();
    const lofos = (await day(t, "2026-11-16")).find((v) => v.route_position === 3)!;
    const r = ok(await handle(t.fnCtx("nikos", { action: "reorder", visit_id: lofos.id, position: 1 })));
    expect(r.visit.route_position).toBe(1);
    const order = await day(t, "2026-11-16");
    expect(order[0]!.id).toBe(lofos.id);
    expect(order.map((v) => v.route_position)).toEqual([1, 2, 3, 4, 5]);
    expect((await t.db.visit_change.all({ visit_id: lofos.id }))[0]).toMatchObject({ change_type: "reordered", via: "app" });
  });

  it("done marks the visit completed (no visit_change: not a plan edit)", async () => {
    const t = kit();
    const v = (await day(t, "2026-11-16"))[0]!;
    const r = ok(await handle(t.fnCtx("nikos", { action: "done", visit_id: v.id })));
    expect(r.visit.status).toBe("done");
    expect((await t.db.visit.require(v.id)).completed_at).toBe(new Date(NOW).toISOString());
    expect(await t.db.visit_change.all({ visit_id: v.id })).toHaveLength(0);
  });

  it("refuses bad input: missing date, past date, reorder without position, unknown action", async () => {
    const t = kit();
    const v = (await day(t, "2026-11-16"))[0]!;
    expect(errCode(await handle(t.fnCtx("nikos", { action: "move", visit_id: v.id })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { action: "move", visit_id: v.id, date: "2026-11-13" })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { action: "reorder", visit_id: v.id })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { action: "teleport", visit_id: v.id })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { action: "add", date: "2026-11-17" })))).toBe("validation_failed");
    expect(await t.db.visit_change.count()).toBe(0);
  });

  it("scope owner: another rep cannot touch Nikos's visit (REQ-CORE-009); spoofed caller ignored", async () => {
    const t = kit();
    const v = (await day(t, "2026-11-16"))[0]!;
    expect(errCode(await handle(t.fnCtx("dimitra", { action: "skip", visit_id: v.id })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("dimitra", { action: "skip", visit_id: v.id, caller: { user_id: IDS.nikos } })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("eleni", { action: "skip", visit_id: v.id })))).toBe("forbidden");
    expect((await t.db.visit.require(v.id)).status).toBe("planned");
  });

  it("functions/visit-update/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "visit-update", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("visit-update"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
