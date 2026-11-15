import { describe, expect, it } from "vitest";
import { loadToday, TodayUnavailableError } from "./loadToday";
import { createCacheEntry, createMemoryTodayCache } from "./planCache";
import { createFakeClient } from "./testing/fakeClient";
import { briefingResult, performanceResult, planResult, todayResult } from "./testing/fixtures";

const NOW = new Date(2026, 10, 15, 8, 0);
const ok = { "today-get": () => todayResult(), "briefing-get": () => briefingResult(), "visit-plan-get": () => planResult(), "my-performance": () => performanceResult(), "tasks-list": () => ({ items: [{ id: "6f9e1a52-1111-4111-8111-111111111111", task_id: "6f9e1a52-1111-4111-8111-111111111111", title: "Send technician", status: "open", due_at: "2026-11-19T09:00:00Z", overdue: false, account_id: null, account_name: "Café Miltos" }], page: { page: 1, limit: 20, total: 1 } }) };
const down = () => {
  throw new Error("Failed to fetch");
};

describe("loadToday (REQ-BRF-004 offline plan cache)", () => {
  it("loads live, calls only the screen's functions, and writes the cache", async () => {
    const { client, calls, screen } = createFakeClient("today", ok);
    const cache = createMemoryTodayCache();
    const r = await loadToday(client, { cache, online: true, now: NOW });
    expect(r.source).toBe("live");
    expect(r.failed).toEqual([]);
    expect(r.data.today.visits).toHaveLength(3);
    expect(calls.map((c) => c.slug).sort()).toEqual(["briefing-get", "my-performance", "tasks-list", "today-get", "visit-plan-get"]);
    expect(r.data.tasks?.map((x) => x.title)).toEqual(["Send technician"]);
    for (const c of calls) expect(screen.functions).toContain(c.slug);
    expect(calls.find((c) => c.slug === "my-performance")?.params).toEqual({ period: "week" });
    expect(cache.entry?.data.today.date).toBe("2026-11-15");
  });

  it("offline: shows today's stops from the last cache without calling the platform", async () => {
    const { client, calls } = createFakeClient("today", ok);
    const cache = createMemoryTodayCache(createCacheEntry({ today: todayResult(), briefing: briefingResult(), plan: null, performance: null }, new Date(2026, 10, 15, 7, 0)));
    const r = await loadToday(client, { cache, online: false, now: NOW });
    expect(calls).toHaveLength(0);
    expect(r).toMatchObject({ source: "cache", fallbackReason: "offline", stale: false });
    expect(r.data.today.visits.map((v) => v.account.name)).toContain("Café Miltos");
  });

  it("falls back to the cache when today-get fails (network error, airplane mode)", async () => {
    const { client } = createFakeClient("today", { ...ok, "today-get": down });
    const cache = createMemoryTodayCache(createCacheEntry({ today: todayResult(), briefing: null, plan: null, performance: null }, new Date(2026, 10, 15, 7, 0)));
    const r = await loadToday(client, { cache, online: true, now: NOW });
    expect(r.source).toBe("cache");
    expect(r.fallbackReason).toBe("upstream_failed");
  });

  it("errors clearly when offline with nothing cached", async () => {
    const { client } = createFakeClient("today", ok);
    await expect(loadToday(client, { cache: createMemoryTodayCache(), online: false, now: NOW })).rejects.toBeInstanceOf(TodayUnavailableError);
    const { client: c2 } = createFakeClient("today", { ...ok, "today-get": down });
    await expect(loadToday(c2, { cache: createMemoryTodayCache(), online: true, now: NOW })).rejects.toMatchObject({ reason: "upstream_failed" });
  });

  it("keeps the day when a secondary section fails, reusing its cached copy", async () => {
    const { client } = createFakeClient("today", { ...ok, "my-performance": down, "briefing-get": down });
    const cache = createMemoryTodayCache(createCacheEntry({ today: todayResult(), briefing: briefingResult("2026-11-14"), plan: null, performance: performanceResult() }, new Date(2026, 10, 14, 7, 0)));
    const r = await loadToday(client, { cache, online: true, now: NOW });
    expect(r.source).toBe("live");
    expect(r.failed.sort()).toEqual(["briefing", "performance"]);
    expect(r.data.performance?.visits_done).toBe(12);
    expect(r.data.briefing).toBeNull(); // yesterday's briefing is not reused
  });

  it("skips briefing-get when the day has no briefing yet", async () => {
    const { client, calls } = createFakeClient("today", { ...ok, "today-get": () => ({ ...todayResult(), briefing_id: null }) });
    const r = await loadToday(client, { cache: createMemoryTodayCache(), online: true, now: NOW });
    expect(calls.map((c) => c.slug)).not.toContain("briefing-get");
    expect(r.data.briefing).toBeNull();
  });

  it("works unchanged against the contract mocks (mock mode)", async () => {
    const { createClient } = await import("../../../lib/client");
    const { SCREENS } = await import("../../../lib/routes");
    const screen = SCREENS.find((s) => s.route === "/rep/today")!;
    const client = createClient({ mock: true, invoker: { invokeFunction: () => Promise.reject(new Error("no platform in mock mode")) } }).forScreen(screen.functions);
    const r = await loadToday(client, { cache: createMemoryTodayCache(), online: true, now: NOW });
    expect(r.source).toBe("live");
    expect(r.failed).toEqual([]);
    expect(r.data.today.visits.length).toBeGreaterThan(0);
  });
});
