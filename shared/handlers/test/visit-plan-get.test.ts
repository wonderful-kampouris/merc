import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsTool, validateResponse } from "../../core/src/index";
import { handle as deployedHandle, makeImpl } from "../src/visit-plan-get";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

// Demo day 2026-11-16 (Monday), 08:00 Athens.
const NOW = Date.parse("2026-11-16T06:00:00Z");
const impl = makeImpl({ now: () => NOW });
const handle = defineFunction("visit-plan-get", impl);
const SEED_PLAN = "0f5b2530-97ba-5d74-9cc4-241c48aeae04";

describe("fn:visit-plan-get (REQ-PLN-002)", () => {
  it("returns the rep's current week Mon-Fri with route-ordered VisitSummaries", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos")));
    expect(validateResponse("visit-plan-get", r).ok).toBe(true);
    expect(r).toMatchObject({ plan_id: SEED_PLAN, week_start: "2026-11-16", status: "accepted" });
    expect(r.days.map((d) => d.date)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
    const monday = r.days[0]!.visits;
    expect(monday.map((v) => v.route_position)).toEqual([1, 2, 3, 4, 5]);
    expect(monday[2]!.account.name).toBe("Bistro Lofos");
    expect(monday[2]!.reason).toMatch(/Hasn't ordered in 12 days/);
    expect(monday[0]!.lat).toBeTypeOf("number");
    expect(monday[0]!.account.city).toBe("Chalandri");
  });

  it("week_start is normalised to its Monday; a week without a plan reads status none", async () => {
    const t = kit();
    expect(ok(await handle(t.fnCtx("nikos", { week_start: "2026-11-19" }))).week_start).toBe("2026-11-16");
    const next = ok(await handle(t.fnCtx("nikos", { week_start: "2026-11-23" })));
    expect(next).toMatchObject({ plan_id: null, status: "none" });
    expect(next.days.every((d) => d.visits.length === 0)).toBe(true);
  });

  it("scope owner_or_team: manager reads a team rep, another rep is forbidden (REQ-CORE-009)", async () => {
    const t = kit();
    expect(ok(await handle(t.fnCtx("eleni", { rep_id: IDS.nikos }))).plan_id).toBe(SEED_PLAN);
    expect(errCode(await handle(t.fnCtx("dimitra", { rep_id: IDS.nikos })))).toBe("forbidden");
    expect(ok(await handle(t.fnCtx("dimitra"))).status).toBe("none");
    expect(errCode(await handle(t.fnCtx(null)))).toBe("forbidden");
  });

  it("ignores a spoofed caller in the body", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("dimitra", { caller: { user_id: IDS.nikos } })));
    expect(r.plan_id).toBeNull();
  });

  it("the buddy tool path gives the same week", async () => {
    const t = kit();
    expect(ok(await runAsTool("visit-plan-get", impl, t.toolCtx("nikos"), {}, t.key))).toEqual(ok(await handle(t.fnCtx("nikos"))));
  });

  it("the deployed entry runs on the real clock", async () => {
    const t = kit();
    expect(validateResponse("visit-plan-get", ok(await deployedHandle(t.fnCtx("nikos")))).ok).toBe(true);
  });

  it("functions/visit-plan-get/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "visit-plan-get", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("visit-plan-get"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
