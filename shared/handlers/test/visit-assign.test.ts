import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, validateResponse } from "../../core/src/index";
import { makeImpl } from "../src/visit-assign";
import { makeImpl as planGet } from "../src/visit-plan-get";
import { kit, ok, errCode, IDS, type Kit } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const NOW = Date.parse("2026-11-16T06:00:00Z");
const handle = defineFunction("visit-assign", makeImpl({ now: () => NOW }));
const getWeek = defineFunction("visit-plan-get", planGet({ now: () => NOW }));
const acc = async (t: Kit, name: string) => (await t.db.account.findOne({ name }))!.id;

describe("fn:visit-assign (REQ-PLN-004)", () => {
  it("Eleni assigns a visit to Dimitra: it is on Dimitra's day (Today) and logged as assigned via manager", async () => {
    const t = kit();
    const pita = await acc(t, "Pita & Psomi");
    const r = ok(await handle(t.fnCtx("eleni", { rep_id: IDS.dimitra, account_id: pita, date: "2026-11-16", purpose: "Check new oven install" })));
    expect(validateResponse("visit-assign", r).ok).toBe(true);
    expect(r.visit).toMatchObject({ planned_date: "2026-11-16", status: "planned", purpose: "Check new oven install", route_position: 1 });
    const row = await t.db.visit.require(r.visit.visit_id);
    expect(row).toMatchObject({ rep_id: IDS.dimitra, origin: "manager" });
    // today-get reads visit by rep_id + planned_date: the same query finds it.
    expect((await t.db.visit.all({ rep_id: IDS.dimitra, planned_date: "2026-11-16" })).map((v) => v.id)).toContain(row.id);
    const week = ok(await getWeek(t.fnCtx("dimitra")));
    expect(week.days[0]!.visits.map((v) => v.visit_id)).toContain(row.id);
    expect((await t.db.visit_change.all({ visit_id: row.id }))[0]).toMatchObject({ change_type: "assigned", via: "manager", changed_by: IDS.eleni, to_date: "2026-11-16" });
  });

  it("joins the rep's plan for that week when there is one", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("eleni", { rep_id: IDS.nikos, account_id: await acc(t, "Zymi Bakery"), date: "2026-11-18" })));
    expect((await t.db.visit.require(r.visit.visit_id)).plan_id).toBe("0f5b2530-97ba-5d74-9cc4-241c48aeae04");
    expect(r.visit.route_position).toBe(3);
  });

  it("refuses: a rep (no team.assign), a user outside the team, an account outside the rep, a past date, a duplicate", async () => {
    const t = kit();
    const pita = await acc(t, "Pita & Psomi");
    expect(errCode(await handle(t.fnCtx("nikos", { rep_id: IDS.dimitra, account_id: pita, date: "2026-11-17" })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("eleni", { rep_id: "00000000-0000-4000-8000-000000000000", account_id: pita, date: "2026-11-17" })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("eleni", { rep_id: IDS.dimitra, account_id: pita, date: "2026-11-13" })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("eleni", { rep_id: IDS.dimitra, account_id: await acc(t, "Old Mill Café"), date: "2026-11-17" })))).toBe("validation_failed");
    ok(await handle(t.fnCtx("eleni", { rep_id: IDS.dimitra, account_id: pita, date: "2026-11-17" })));
    expect(errCode(await handle(t.fnCtx("eleni", { rep_id: IDS.dimitra, account_id: pita, date: "2026-11-17" })))).toBe("conflict");
    const kolonaki = await acc(t, "Kolonaki Corner");
    expect(["forbidden", "validation_failed"]).toContain(errCode(await handle(t.fnCtx("eleni", { rep_id: IDS.dimitra, account_id: kolonaki, date: "2026-11-17" }))));
  });

  it("ignores a spoofed caller in the body", async () => {
    const t = kit();
    const out = await handle(t.fnCtx("nikos", { rep_id: IDS.dimitra, account_id: await acc(t, "Pita & Psomi"), date: "2026-11-17", caller: { user_id: IDS.eleni, role: "manager" } }));
    expect(errCode(out)).toBe("forbidden");
  });

  it("functions/visit-assign/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "visit-assign", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("visit-assign"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
