import { describe, expect, it } from "vitest";
import { createCacheEntry, parseTodayCache } from "./planCache";
import { briefingResult, todayResult } from "./testing/fixtures";

describe("Today plan cache", () => {
  it("round-trips a cache entry through JSON", () => {
    const e = createCacheEntry({ today: todayResult(), briefing: briefingResult(), plan: null, performance: null }, new Date("2026-11-15T07:00:00Z"));
    const back = parseTodayCache(JSON.stringify(e));
    expect(back?.savedAt).toBe("2026-11-15T07:00:00.000Z");
    expect(back?.data.today.visits.map((v) => v.account.name)).toEqual(["Bistro Lofos", "Café Miltos", "Café Avra"]);
    expect(back?.data.briefing?.items).toHaveLength(2);
  });

  it("ignores missing, malformed, wrong-version and contract-invalid entries", () => {
    expect(parseTodayCache(null)).toBeNull();
    expect(parseTodayCache("{not json")).toBeNull();
    expect(parseTodayCache(JSON.stringify({ v: 2, savedAt: "x", data: {} }))).toBeNull();
    expect(parseTodayCache(JSON.stringify({ v: 1, savedAt: "x", data: { today: { date: "2026-11-15" } } }))).toBeNull();
  });

  it("drops an invalid optional section but keeps the day", () => {
    const e = { v: 1, savedAt: "2026-11-15T07:00:00.000Z", data: { today: todayResult(), briefing: { nope: 1 }, plan: null, performance: null } };
    const back = parseTodayCache(JSON.stringify(e));
    expect(back?.data.briefing).toBeNull();
    expect(back?.data.today.visits).toHaveLength(3);
  });
});
