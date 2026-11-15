import { describe, expect, test } from "vitest";
import { mockResult, type KpiSet, type TargetProgress } from "../../../contracts";
import { createClient } from "../../../lib/client";
import { SCREENS } from "../../../lib/routes";
import { ALL_TILES, baselineDelta, deltaLabel, drillRow, kpiRequest, stageBars, targetPace, tileValue } from "./logic";
import { periodRange, monthRange, daysAgo } from "./shared/period";
import { money } from "./shared/format";

const screen = SCREENS.find((s) => s.route === "/mgmt/dashboard")!;
const kpis = (over: Partial<KpiSet> = {}): KpiSet => ({ ...mockResult("dashboard-kpis", { scope: "team", from: "2026-11-01", to: "2026-11-15" }).kpis, ...over });

describe("periods", () => {
  const sun = new Date(2026, 10, 15); // Sunday 15 Nov 2026
  test("week starts Monday", () => expect(periodRange("week", sun)).toEqual({ from: "2026-11-09", to: "2026-11-15" }));
  test("month, last30, quarter", () => {
    expect(periodRange("month", sun).from).toBe("2026-11-01");
    expect(periodRange("last30", sun).from).toBe("2026-10-17");
    expect(periodRange("quarter", sun).from).toBe("2026-10-01");
  });
  test("monthRange and daysAgo", () => {
    expect(monthRange(0, sun)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthRange(1, new Date(2026, 11, 3))).toEqual({ from: "2027-01-01", to: "2027-01-31" });
    expect(daysAgo(30, sun)).toBe("2026-10-16");
    expect(daysAgo(null, sun)).toBeNull();
  });
});

describe("KPI tiles", () => {
  test("every KPI in the contract's KpiSet is on a tile (except lists)", () => {
    const shown = new Set(ALL_TILES.flatMap((t) => (t.pair ? [...t.pair] : [t.key])));
    const fields = Object.keys(kpis()).filter((k) => !["pipeline_by_stage", "targets", "baseline"].includes(k));
    expect(fields.filter((f) => !shown.has(f))).toEqual([]);
  });
  test("drill-down kpis are values of the kpi-drilldown enum", async () => {
    const client = createClient({ mock: true, invoker: { invokeFunction: async () => ({}) } }).forScreen(screen.functions);
    for (const tile of ALL_TILES) {
      const r = await client.call("kpi-drilldown", { kpi: tile.drill, from: "2026-11-01", to: "2026-11-15" });
      expect(Array.isArray(r.items)).toBe(true);
    }
  });
  test("money tiles format minor units in EUR", () => {
    const k = kpis({ revenue_minor: 1234500 });
    expect(tileValue(k, ALL_TILES.find((t) => t.key === "revenue_minor")!, "en")).toBe("€12k");
    expect(money(1234500, "en")).toBe("€12,345");
    expect(money(1999, "el")).toMatch(/19,99/);
    expect(tileValue(kpis({ approvals_approved: 3, approvals_rejected: 1 }), ALL_TILES.find((t) => t.key === "approvals")!, "en")).toBe("3 / 1");
  });
  test("baseline before/after (metrics.md#before-after)", () => {
    const tile = ALL_TILES.find((t) => t.key === "crm_completeness_pct")!;
    const d = baselineDelta(kpis({ crm_completeness_pct: 82, baseline: { crm_completeness_pct: 41 } }), tile)!;
    expect(d).toMatchObject({ before: 41, delta: 41, direction: "up", good: true });
    expect(deltaLabel(d, tile, "en")).toBe("+41 pp");
    const risk = ALL_TILES.find((t) => t.key === "at_risk_customers")!;
    expect(baselineDelta(kpis({ at_risk_customers: 3, baseline: { at_risk_customers: 7 } }), risk)).toMatchObject({ direction: "down", good: true });
    expect(baselineDelta(kpis({ baseline: null }), tile)).toBeUndefined();
  });
});

test("pipeline bars follow stage order with shares of the largest", () => {
  const k = kpis({
    pipeline_by_stage: [
      { stage_code: "negotiation", amount_minor: 500, count: 1 },
      { stage_code: "new", amount_minor: 1000, count: 4 },
    ],
  });
  expect(stageBars(k, ["new", "qualified", "negotiation"]).map((b) => [b.stage_code, b.share])).toEqual([["new", 100], ["negotiation", 50]]);
});

test("target pace against elapsed period", () => {
  const t = (pct: number): TargetProgress => ({ target_id: "x", metric: "revenue", period_start: "2026-11-01", period_end: "2026-11-30", target_value: 100, actual_value: pct, pct, days_left: 15 });
  const mid = new Date(2026, 10, 15);
  expect(targetPace(t(60), mid)).toBe("ahead");
  expect(targetPace(t(42), mid)).toBe("behind");
  expect(targetPace(t(10), mid)).toBe("off");
});

test("request carries only set filters and asks for the baseline", () => {
  expect(kpiRequest({ scope: "org", from: "a", to: "b", territoryId: null, repId: "r" })).toEqual({ scope: "org", from: "a", to: "b", compare_baseline: true, rep_id: "r" });
});

test("drill rows read loosely typed records", () => {
  const r = drillRow({ id: "1234567890", name: "Café Miltos", account_type: "customer", risk_score: 72, owner_rep_id: "u1" }, "en", (_k, id) => (id === "u1" ? "Nikos" : undefined));
  expect(r).toEqual({ id: "1234567890", title: "Café Miltos", description: "customer · risk 72 · Nikos" });
  expect(drillRow({ id: "abcdefghijk" }, "en", () => undefined).title).toBe("#abcdefgh");
});

test("the dashboard may call only its app.json functions", async () => {
  const client = createClient({ mock: true, invoker: { invokeFunction: async () => ({}) } }).forScreen(screen.functions);
  expect(screen.functions).toEqual(["dashboard-kpis", "kpi-drilldown", "targets-list", "team-list", "territories-list"]);
  await expect(client.call("deals-list", {})).rejects.toMatchObject({ code: "forbidden" });
  const r = await client.call("dashboard-kpis", kpiRequest({ scope: "team", ...periodRange("month"), territoryId: null, repId: null }));
  expect(r.kpis).toBeTruthy();
});

describe("REQ-DSH-002: every KPI drills down to its records", () => {
  test("every tile has a kpi-drilldown kpi, and the enum values it uses are exactly the tiles' figures", () => {
    for (const tile of ALL_TILES) expect(typeof tile.drill).toBe("string");
    expect(ALL_TILES.find((x) => x.key === "revenue_minor")!.drill).toBe("revenue");
    expect(ALL_TILES.find((x) => x.key === "visits_per_rep_day")!.drill).toBe("visits");
    expect(ALL_TILES.find((x) => x.key === "ai_actions")!.drill).toBe("ai_actions");
    expect(ALL_TILES.find((x) => x.key === "approvals")!.drill).toBe("approvals");
    expect(ALL_TILES.find((x) => x.key === "discounts")!.drill).toBe("discounts");
  });
});
