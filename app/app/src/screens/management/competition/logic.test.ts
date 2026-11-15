import { describe, expect, test } from "vitest";
import { seedRows } from "../../../contracts";
import { createClient } from "../../../lib/client";
import { SCREENS } from "../../../lib/routes";
import { directory } from "../dashboard/shared/directory";
import { applyFilters, byCompetitor, byTerritory, listRequest, newestFirst, toSignal } from "./logic";

const screen = SCREENS.find((s) => s.route === "/mgmt/competition")!;
const dir = directory();
const AROMA = "94cc0e65-3b44-5d48-b419-32e51aa11446";
const NORTH = "76b55561-9135-5c55-ad43-34661bffd9d9";
const seedSignals = () => seedRows("competitor_signal").map((r) => toSignal(r, dir));

test("the seed shows 3 Aroma signals in the North (REQ-DSH-006 acceptance)", () => {
  const xs = seedSignals();
  const north = byTerritory(xs, "none").find((b) => b.id === NORTH)!;
  expect(north.name).toBe("North");
  const aromaNorth = applyFilters(xs, { competitorId: AROMA, territoryId: NORTH, since: null });
  expect(aromaNorth).toHaveLength(3);
  expect(aromaNorth.every((x) => x.competitor === "Aroma Delta")).toBe(true);
  const top = byCompetitor(xs)[0]!;
  expect(top).toMatchObject({ name: "Aroma Delta", count: 3, avgDelta: -15.7, share: 100 });
});

test("labels prefer the row's joins over the directory", () => {
  const x = toSignal({ id: "s1", competitor_id: "c9", competitor_name: "Joined Co", account: { id: "a1", name: "Shop" }, territory_name: "East", price_delta_pct: 5, reported_by_name: "Maria" }, dir);
  expect(x).toMatchObject({ competitor: "Joined Co", account: "Shop", territory: "East", reporter: "Maria", price_delta_pct: 5 });
  expect(toSignal({ id: "s2", competitor_id: "0000000000" }, dir).competitor).toBe("#00000000");
});

test("time filter and order", () => {
  const today = new Date(2026, 10, 15);
  const xs = [toSignal({ id: "a", competitor_id: AROMA, observed_at: "2026-11-10T10:00:00Z" }, dir), toSignal({ id: "b", competitor_id: AROMA, observed_at: "2026-01-01T10:00:00Z" }, dir)];
  expect(applyFilters(xs, { competitorId: null, territoryId: null, since: 30 }, today).map((x) => x.id)).toEqual(["a"]);
  expect(newestFirst(xs.reverse()).map((x) => x.id)).toEqual(["a", "b"]);
  expect(listRequest({ competitorId: AROMA, territoryId: null, since: 30 }, today)).toEqual({ limit: 200, competitor_id: AROMA, from: "2026-10-16" });
});

test("mock mode: the list call validates and only its function is allowed", async () => {
  const client = createClient({ mock: true, invoker: { invokeFunction: async () => ({}) } }).forScreen(screen.functions);
  expect(screen.functions).toEqual(["competitor-signals-list", "team-list", "territories-list"]);
  expect((await client.call("territories-list", {})).items.length).toBeGreaterThan(0);
  const r = await client.call("competitor-signals-list", listRequest({ competitorId: null, territoryId: NORTH, since: 90 }));
  expect(r.items.map((x) => toSignal(x, dir)).every((x) => x.competitor.length > 0)).toBe(true);
  await expect(client.call("targets-list", {})).rejects.toMatchObject({ code: "forbidden" });
});

describe("REQ-DSH-006 on the demo seed", () => {
  test("shows 3 Aroma Delta signals in the North within the default 90 days", () => {
    const today = new Date();
    const dir = directory();
    const signals = seedRows("competitor_signal", { demoDay: today }).map((r) => toSignal(r, dir));
    const shown = applyFilters(signals, { competitorId: null, territoryId: null, since: 90 }, today);
    const north = byTerritory(shown, "-").find((b) => b.name === "North");
    expect(north?.count).toBe(3);
    const aromaNorth = shown.filter((x) => x.competitor === "Aroma Delta" && x.territory === "North");
    expect(aromaNorth).toHaveLength(3);
    expect(byCompetitor(shown)[0]).toMatchObject({ name: "Aroma Delta", count: 3 });
  });
});
