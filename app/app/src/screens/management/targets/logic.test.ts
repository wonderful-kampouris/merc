import { expect, test } from "vitest";
import { mockResult, type TargetProgress } from "../../../contracts";
import { createClient, MercApiError } from "../../../lib/client";
import { SCREENS } from "../../../lib/routes";
import { blankForm, byMetric, formFromTarget, knowsScope, listRequest, upsertRequest, validate } from "./logic";

const screen = SCREENS.find((s) => s.route === "/mgmt/targets")!;
const nov = new Date(2026, 10, 15);
const NIKOS = "d72bccf8-f36c-5abf-8d0d-142783f090cd";

test("period choices map to targets-list period_start", () => {
  expect(listRequest("this", nov)).toEqual({ period_start: "2026-11-01" });
  expect(listRequest("next", nov)).toEqual({ period_start: "2026-12-01" });
  expect(listRequest("last", nov)).toEqual({ period_start: "2026-10-01" });
  expect(listRequest("all", nov)).toEqual({});
});

test("validation: scope id, period order, value", () => {
  const f = blankForm(nov);
  expect(validate(f).sort()).toEqual(["v.scopeId", "v.value"]);
  expect(validate({ ...f, user_id: NIKOS, value: 5 })).toEqual([]);
  expect(validate({ ...f, scope: "org", value: 5, period_end: "2026-10-31" })).toEqual(["v.period"]);
  expect(validate({ ...f, scope: "territory", value: 5 })).toEqual(["v.scopeId"]);
});

test("upsert body: only the scope's id, revenue euros to minor units", () => {
  const f = { ...blankForm(nov), user_id: NIKOS, territory_id: "ignored", value: 12000.5 };
  expect(upsertRequest(f)).toEqual({ scope: "user", user_id: NIKOS, metric: "revenue", period_start: "2026-11-01", period_end: "2026-11-30", target_value: 1200050 });
  expect(upsertRequest({ ...f, scope: "org", metric: "visits", value: 80, target_id: "t1" })).toEqual({ target_id: "t1", scope: "org", metric: "visits", period_start: "2026-11-01", period_end: "2026-11-30", target_value: 80 });
});

test("edit form from a listed target converts revenue back to euros; scope unknown without extra fields", () => {
  const t: TargetProgress = { target_id: "t1", metric: "revenue", period_start: "2026-11-01", period_end: "2026-11-30", target_value: 3000000, actual_value: 1, pct: 40, days_left: 15 };
  expect(formFromTarget(t)).toMatchObject({ target_id: "t1", value: 30000, scope: "user", user_id: "" });
  expect(knowsScope(t)).toBe(false);
  expect(knowsScope({ ...t, user_id: NIKOS } as TargetProgress)).toBe(true);
});

test("grouped by metric, weakest first", () => {
  const mk = (id: string, metric: TargetProgress["metric"], pct: number): TargetProgress => ({ target_id: id, metric, period_start: "a", period_end: "b", target_value: 1, actual_value: 1, pct, days_left: 1 });
  expect(byMetric([mk("1", "visits", 90), mk("2", "revenue", 70), mk("3", "revenue", 20)]).map((g) => [g.metric, g.items.map((i) => i.target_id)])).toEqual([["revenue", ["3", "2"]], ["visits", ["1"]]]);
});

test("mock mode: list and upsert pass contract validation", async () => {
  const client = createClient({ mock: true, invoker: { invokeFunction: async () => ({}) } }).forScreen(screen.functions);
  expect(screen.functions).toEqual(["targets-list", "target-upsert", "team-list", "territories-list"]);
  expect((await client.call("team-list", {})).items.length).toBeGreaterThan(0);
  expect((await client.call("targets-list", listRequest("this"))).items.length).toBeGreaterThan(0);
  await expect(client.call("target-upsert", upsertRequest({ ...blankForm(), user_id: NIKOS, value: 100 }))).resolves.toHaveProperty("target_id");
});

test("an overlapping duplicate comes back as conflict (REQ-TGT-001)", async () => {
  const invoker = { invokeFunction: async () => ({ error: { code: "conflict", message: "overlapping target" } }) };
  const client = createClient({ mock: false, invoker }).forScreen(screen.functions);
  const err = await client.call("target-upsert", upsertRequest({ ...blankForm(), user_id: NIKOS, value: 100 })).catch((e) => e);
  expect(err).toBeInstanceOf(MercApiError);
  expect(err.code).toBe("conflict");
  expect(mockResult("targets-list", {}).items[0]).toHaveProperty("pct");
});
