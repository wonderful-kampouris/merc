import { afterEach, describe, expect, it } from "vitest";
import { addDays, dateRange, dayRange, daysBetween, datesBetween, endOfMonth, lastDaysRange, localDate, localParts, monthRange, nextWeekday, setOffsetSource, today, tzOffsetMinutes, weekday, weekRange, withinLocalHours, zonedInstant } from "../src/index";

const ATH = "Europe/Athens";
const at = (iso: string) => Date.parse(iso);

describe("org-timezone dates (REQ-CORE-007)", () => {
  afterEach(() => setOffsetSource(null));

  it("today() is the org's local date, not UTC's", () => {
    // 22:30 UTC on 15 Nov = 00:30 on 16 Nov in Athens (UTC+2 in winter)
    expect(today(ATH, at("2026-11-15T22:30:00Z"))).toBe("2026-11-16");
    expect(today("UTC", at("2026-11-15T22:30:00Z"))).toBe("2026-11-15");
    expect(today({ timezone: ATH }, at("2026-11-15T21:59:00Z"))).toBe("2026-11-15");
  });

  it("offsets follow DST", () => {
    expect(tzOffsetMinutes(ATH, at("2026-07-01T12:00:00Z"))).toBe(180);
    expect(tzOffsetMinutes(ATH, at("2026-12-01T12:00:00Z"))).toBe(120);
  });

  it("day/week/month ranges are half-open UTC intervals of local days", () => {
    expect(dayRange(ATH, "2026-11-16")).toEqual({ from: "2026-11-15T22:00:00.000Z", to: "2026-11-16T22:00:00.000Z", fromDate: "2026-11-16", toDate: "2026-11-16" });
    const w = weekRange(ATH, "2026-11-18"); // a Wednesday
    expect([w.fromDate, w.toDate]).toEqual(["2026-11-16", "2026-11-22"]);
    const m = monthRange(ATH, "2026-02-10");
    expect([m.fromDate, m.toDate, m.from]).toEqual(["2026-02-01", "2026-02-28", "2026-01-31T22:00:00.000Z"]);
    // the range spanning the October DST change: start at +3, end at +2
    const r = dateRange(ATH, "2026-10-24", "2026-10-25");
    expect([r.from, r.to]).toEqual(["2026-10-23T21:00:00.000Z", "2026-10-25T22:00:00.000Z"]);
    expect(lastDaysRange(ATH, 7, at("2026-11-16T10:00:00Z")).fromDate).toBe("2026-11-10");
    expect(() => dateRange(ATH, "2026-11-17", "2026-11-16")).toThrow(/ends before/);
  });

  it("calendar arithmetic", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekday("2026-11-16")).toBe(1); // Monday
    expect(weekday("2026-11-22")).toBe(7);
    expect(daysBetween("2026-11-04", "2026-11-16")).toBe(12);
    expect(datesBetween("2026-11-16", "2026-11-18")).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
    expect(endOfMonth("2028-02-03")).toBe("2028-02-29");
    // REQ-DEB-006: "Thursday" said on Monday 16 Nov = 19 Nov; said on a Thursday = the next one
    expect(nextWeekday("2026-11-16", 4)).toBe("2026-11-19");
    expect(nextWeekday("2026-11-19", 4)).toBe("2026-11-26");
    expect(nextWeekday("2026-11-19", 4, { includeToday: true })).toBe("2026-11-19");
    expect(() => addDays("2026-02-30", 1)).toThrow(/not a calendar date/);
  });

  it("local wall clock and the 08:00-20:00 call window (REQ-APV-003)", () => {
    expect(zonedInstant(ATH, "2026-11-16", "09:30")).toBe("2026-11-16T07:30:00.000Z");
    expect(localParts(ATH, "2026-11-16T07:30:00Z")).toMatchObject({ date: "2026-11-16", time: "09:30", weekday: 1 });
    expect(localDate(ATH, "2026-11-15T23:10:00Z")).toBe("2026-11-16");
    expect(withinLocalHours(ATH, "08:00", "20:00", "2026-11-16T05:59:00Z")).toBe(false); // 07:59
    expect(withinLocalHours(ATH, "08:00", "20:00", "2026-11-16T06:00:00Z")).toBe(true); // 08:00
    expect(withinLocalHours(ATH, "08:00", "20:00", "2026-11-16T19:00:00Z")).toBe(false); // 21:00 -> async
    expect(withinLocalHours(ATH, "22:00", "06:00", "2026-11-16T23:00:00Z")).toBe(true); // 01:00, wraps midnight
  });

  it("works on a runtime with only Moment (no Intl): uses the injected/fallback offset source", () => {
    setOffsetSource((tz, ms) => (tz === ATH ? (ms < at("2026-10-25T01:00:00Z") ? 180 : 120) : 0));
    expect(today(ATH, at("2026-11-15T22:30:00Z"))).toBe("2026-11-16");
    expect(dayRange(ATH, "2026-10-25").from).toBe("2026-10-24T21:00:00.000Z");
  });

  it("rejects bad zones and inputs with validation_failed", () => {
    let code = "";
    try { today("Mars/Olympus", 0); } catch (e) { code = (e as any).code; }
    expect(code).toBe("validation_failed");
    expect(() => zonedInstant(ATH, "2026-11-16", "25:00")).toThrow(/HH:MM/);
  });
});
