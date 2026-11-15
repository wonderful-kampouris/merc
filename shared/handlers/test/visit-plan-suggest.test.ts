import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsSystem, validateResponse } from "../../core/src/index";
import { makeHandle, makeImpl, routeOrder } from "../src/visit-plan-suggest";
import { kit, IDS, type Kit } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

// The real schedule: Sunday 2026-11-22 18:00 Athens -> plans the week of Monday 2026-11-23.
const NOW = Date.parse("2026-11-22T16:00:00Z");
const WEEK = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"];
const run = (t: Kit, data: unknown = {}, api: unknown = undefined) =>
  makeHandle({ now: () => NOW })({ tables: t.tables, data, api, metadata: {} } as any) as Promise<any>;
const planned = async (t: Kit) =>
  (await t.db.visit.all({ planned_date: WEEK, origin: "plan" }))
    .map((v) => `${v.rep_id}|${v.planned_date}|${v.route_position}|${v.account_id}|${v.purpose}`).sort();

describe("fn:visit-plan-suggest (REQ-PLN-001, metrics.md#visit-plan)", () => {
  it("proposes next week per active rep, under visits_per_day, with reasons and routes", async () => {
    const t = kit();
    const out = await run(t);
    expect(out.orgs).toBe(1);
    expect(out.failed).toBe(0);
    const res = out.runs[0].outcome;
    expect(validateResponse("visit-plan-suggest", res).ok).toBe(true);
    expect(res.created).toBe(res.processed);
    expect(res.processed).toBeGreaterThanOrEqual(3);
    expect(res.details.week_start).toBe("2026-11-23");

    const plan = (await t.db.visit_plan.findOne({ rep_id: IDS.nikos, week_start: "2026-11-23" }))!;
    expect(plan.status).toBe("proposed");
    const visits = await t.db.visit.all({ plan_id: plan.id });
    expect(visits.length).toBeGreaterThan(0);
    const cap = (await t.db.organization.require(IDS.org)).visits_per_day;
    for (const d of WEEK) {
      const onDay = visits.filter((v) => v.planned_date === d).sort((a, b) => a.route_position! - b.route_position!);
      expect(onDay.length).toBeLessThanOrEqual(cap);
      expect(onDay.map((v) => v.route_position)).toEqual(onDay.map((_, i) => i + 1));
    }
    expect(visits.every((v) => v.origin === "plan" && v.status === "planned" && !!v.purpose)).toBe(true);
    // Lost accounts never planned; everything belongs to the rep.
    const lost = (await t.db.account.findOne({ name: "Old Mill Café" }))!.id;
    expect(visits.some((v) => v.account_id === lost)).toBe(false);
    const owned = new Set((await t.db.account.all({ owner_rep_id: IDS.nikos })).map((a) => a.id));
    expect(visits.every((v) => owned.has(v.account_id))).toBe(true);
    // The open customer promise (Bistro Lofos offer, already due) is placed on the first day, with its reason.
    const lofos = (await t.db.account.findOne({ name: "Bistro Lofos" }))!.id;
    expect(visits.find((v) => v.account_id === lofos)).toMatchObject({ planned_date: "2026-11-23" });
  });

  it("is deterministic: the same seed gives the same plan", async () => {
    const a = kit(), b = kit();
    await run(a); await run(b);
    expect(await planned(a)).toEqual(await planned(b));
    const d1 = (await run(kit(), { dry_run: true })).runs[0].outcome.details;
    const d2 = (await run(kit(), { dry_run: true })).runs[0].outcome.details;
    expect(d1).toEqual(d2);
  });

  it("the cap holds when the day is full: visits_per_day 2", async () => {
    const eligible = (await run(kit(), { dry_run: true })).runs[0].outcome.details.plans.find((p: any) => p.rep_id === IDS.nikos).stops.length;
    const t = kit();
    await t.db.organization.update(IDS.org, { visits_per_day: 2 });
    const res = (await run(t)).runs[0].outcome;
    const visits = await t.db.visit.all({ rep_id: IDS.nikos, planned_date: WEEK });
    for (const d of WEEK) expect(visits.filter((v) => v.planned_date === d).length).toBeLessThanOrEqual(2);
    expect(visits.length).toBe(Math.min(10, eligible));
    expect(res.details.plans.find((p: any) => p.rep_id === IDS.nikos).unplaced.length).toBe(Math.max(0, eligible - 10));
  });

  it("dry_run writes nothing; a re-run leaves existing plans alone", async () => {
    const t = kit();
    const dry = (await run(t, { dry_run: true })).runs[0].outcome;
    expect(dry.created).toBe(0);
    expect(await t.db.visit_plan.count({ week_start: "2026-11-23" })).toBe(0);
    expect(dry.details.plans[0].stops.length).toBeGreaterThan(0);
    await run(t);
    const before = await planned(t);
    const again = (await run(t)).runs[0].outcome;
    expect(again.created).toBe(0);
    expect(await planned(t)).toEqual(before);
  });

  it("a visit already booked next week keeps its slot and joins the plan", async () => {
    const t = kit();
    const zymi = (await t.db.account.findOne({ name: "Zymi Bakery" }))!.id;
    const booked = await t.db.visit.insert({ account_id: zymi, rep_id: IDS.nikos, origin: "manager", planned_date: "2026-11-23", route_position: 1, status: "planned" } as any);
    await run(t);
    const plan = (await t.db.visit_plan.findOne({ rep_id: IDS.nikos, week_start: "2026-11-23" }))!;
    expect((await t.db.visit.require(booked.id)).plan_id).toBe(plan.id);
    const monday = await t.db.visit.all({ rep_id: IDS.nikos, planned_date: "2026-11-23" });
    expect(monday.filter((v) => v.account_id === zymi)).toHaveLength(1);
    expect(monday.filter((v) => v.origin === "plan").every((v) => v.route_position! > 1)).toBe(true);
  });

  it("pushes plan.proposed to rep:{id}; without a service account it still plans and says so", async () => {
    const t = kit();
    const posts: any[] = [];
    const res = (await run(t, {}, { post: async (path: string, o: any) => { posts.push({ path, ...o }); return {}; } })).runs[0].outcome;
    const nikosPlan = (await t.db.visit_plan.findOne({ rep_id: IDS.nikos, week_start: "2026-11-23" }))!;
    expect(posts.find((p) => p.body.channel === `rep:${IDS.nikos}`)).toMatchObject({
      path: "/v1/function-sockets/messages",
      body: { data: { type: "plan.proposed", payload: { plan_id: nikosPlan.id, week_start: "2026-11-23" } } },
    });
    expect(res.details.plans.every((p: any) => p.pushed === true)).toBe(true);
    const t2 = kit();
    const res2 = (await run(t2)).runs[0].outcome;
    expect(res2.created).toBeGreaterThan(0);
    expect(res2.details.plans.every((p: any) => p.pushed === "no_service_account")).toBe(true);
  });

  it("runs as a system principal only (cron caller); request is contract-checked", async () => {
    const t = kit();
    const bad: any = await runAsSystem("visit-plan-suggest", makeImpl({ now: () => NOW }), { tables: t.tables, data: { dry_run: "yes" }, orgId: IDS.org });
    expect(bad.error.code).toBe("validation_failed");
  });

  it("routeOrder is greedy nearest neighbour from the first stop", () => {
    const pts = [{ n: "A", lat: 0, lng: 0 }, { n: "far", lat: 0, lng: 3 }, { n: "near", lat: 0, lng: 1 }, { n: "nowhere", lat: NaN, lng: NaN }, { n: "mid", lat: 0, lng: 2 }];
    const order = routeOrder(pts, (p) => (Number.isFinite(p.lat) ? p : null)).map((p) => p.n);
    expect(order).toEqual(["A", "near", "mid", "far", "nowhere"]);
  });

  it("functions/visit-plan-suggest/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "visit-plan-suggest", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("visit-plan-suggest"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
