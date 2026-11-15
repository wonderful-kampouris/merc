import { describe, expect, it } from "vitest";
import { clampPct, dataForDate, formatMoney, formatTargetValue, localDate, sortStops, summarizeStops, visitsForDate } from "./todayModel";
import { LOFOS, planResult, todayResult, visit } from "./testing/fixtures";

describe("today model", () => {
  it("sorts stops by route position, unset positions last", () => {
    const v = [visit(9, "Zeta", LOFOS, null), ...todayResult().visits];
    expect(sortStops(v).map((x) => x.account.name)).toEqual(["Café Miltos", "Bistro Lofos", "Café Avra", "Zeta"]);
  });

  it("summarizes done / planned and the next planned stop", () => {
    const s = summarizeStops(todayResult().visits);
    expect(s).toMatchObject({ total: 3, done: 1, planned: 2, skipped: 0 });
    expect(s.next?.account.name).toBe("Bistro Lofos");
  });

  it("takes the day from the cached week plan when today-get was cached for another day", () => {
    const data = { today: todayResult("2026-11-15"), briefing: null, plan: planResult("2026-11-16"), performance: null };
    expect(visitsForDate(data.plan, "2026-11-16")?.[0]?.account.name).toBe("Bakery Ilios");
    const r = dataForDate(data, "2026-11-16");
    expect(r.stale).toBe(false);
    expect(r.data.today.date).toBe("2026-11-16");
    expect(r.data.today.visits[0]?.account.name).toBe("Bakery Ilios");
    expect(dataForDate(data, "2026-11-20").stale).toBe(true);
    expect(dataForDate(data, "2026-11-15").data).toBe(data);
  });

  it("formats money from minor units and clamps percentages", () => {
    expect(formatMoney(384000, "en")).toBe("€3,840");
    expect(formatTargetValue("revenue", 1800000, "en")).toBe("€18,000");
    expect(formatTargetValue("visits", 110, "en")).toBe("110");
    expect(clampPct(143)).toBe(100);
    expect(clampPct(-3)).toBe(0);
    expect(clampPct(Number.NaN)).toBe(0);
    expect(localDate(new Date(2026, 10, 5, 23, 59))).toBe("2026-11-05");
  });
});
