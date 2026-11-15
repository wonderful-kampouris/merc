import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { testFilter, type Filter } from "../../../shared/core/src/tables";
import { WATCHES, WATCH_KEYS, evaluate, percentile, tsOf, type Row, type Source } from "../src/watches.ts";
import { handle, MonitorBreach } from "../src/entry.ts";
import { allBodies, contractMonitors, cronPeriodMin, monitorBody, watchSlug, FUNCTION_ERRORS_THRESHOLD } from "../src/monitors.ts";
import { bundleText, configJson, OUT } from "../src/build.ts";

const NOW = Date.parse("2026-11-16T10:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

/** In-memory Source with the same filter semantics as the platform (shared/core testFilter). */
function mem(tables: Record<string, Row[]>): Source & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async rows(t: string, f: Filter[]) { calls.push(t); return (tables[t] ?? []).filter((r) => f.every((x) => testFilter(r, x))); },
  };
}
/** The same rows behind a TablesApi, as the deployed cron sees context.tables. */
function api(tables: Record<string, Row[]>) {
  return {
    async filter(q: string, f: Filter[]) { const rows = (tables[q.replace(/^merc\./, "")] ?? []).filter((r) => f.every((x) => testFilter(r, x))); return { rows: rows.map((r) => ({ id: r.id, data: r })), total: rows.length }; },
    getRow: async () => { throw new Error("unused"); }, insert: async () => { throw new Error("unused"); }, update: async () => { throw new Error("unused"); }, deleteRow: async () => {}, count: async () => 0,
  } as any;
}

describe("helpers", () => {
  it("percentile is nearest-rank", () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    const xs = Array.from({ length: 20 }, (_, i) => (i + 1) * 1000);
    expect(percentile(xs, 95)).toBe(19_000);
    expect(percentile(xs, 50)).toBe(10_000);
  });
  it("tsOf reads ISO, epoch ms and epoch seconds", () => {
    expect(tsOf("2026-11-16T10:00:00Z")).toBe(NOW);
    expect(tsOf(NOW)).toBe(NOW);
    expect(tsOf(NOW / 1000)).toBe(NOW);
    expect(Number.isNaN(tsOf(null))).toBe(true);
  });
  it("cron periods", () => {
    expect(cronPeriodMin("*/5 * * * *")).toBe(5);
    expect(cronPeriodMin("0 * * * *")).toBe(60);
    expect(() => cronPeriodMin("0 9 * * 1")).toThrow();
  });
});

describe("debrief-latency (p95 > 20 s over 15 min)", () => {
  const vl = (id: string, ms: number, minAgo: number) => ({ id, status: "completed", processing_ms: ms, processed_at: ago(minAgo) });
  it("19 fast runs and 1 slow one stay under (p95 is the 19th)", async () => {
    const rows = [...Array.from({ length: 19 }, (_, i) => vl(`v${i}`, 8000, 3)), vl("slow", 31_000, 2)];
    const r = await evaluate("debrief-latency", mem({ voice_log: rows }), NOW);
    expect(r).toMatchObject({ value: 8000, samples: 20, breached: false, ids: ["slow"] });
  });
  it("an injected slow run breaches when it is the tail", async () => {
    const r = await evaluate("debrief-latency", mem({ voice_log: [vl("a", 9000, 1), vl("slow", 30_000, 1)] }), NOW);
    expect(r).toMatchObject({ value: 30_000, breached: true });
  });
  it("runs older than 15 min and unprocessed logs are ignored", async () => {
    const r = await evaluate("debrief-latency", mem({ voice_log: [vl("old", 60_000, 16), { id: "p", status: "processing", processing_ms: null, processed_at: null }] }), NOW);
    expect(r).toMatchObject({ value: 0, samples: 0, breached: false });
  });
});

describe("count watches", () => {
  const upd = (min: number) => NOW - min * 60_000;
  it("voice-log-failures fires on the 4th failure in an hour, not the 3rd", async () => {
    const f = (id: string, m: number) => ({ id, status: "failed", updated_at: upd(m) });
    const three = [f("a", 5), f("b", 10), f("c", 50), f("old", 61), { id: "ok", status: "completed", updated_at: upd(1) }];
    expect((await evaluate("voice-log-failures", mem({ voice_log: three }), NOW)).breached).toBe(false);
    expect((await evaluate("voice-log-failures", mem({ voice_log: [...three, f("d", 1)] }), NOW))).toMatchObject({ value: 4, breached: true });
  });
  it("approval-sla-breach counts escalations in the last day", async () => {
    const rows = [{ id: "e1", status: "escalated", updated_at: upd(600) }, { id: "e0", status: "escalated", updated_at: upd(60 * 25) }, { id: "p", status: "pending", updated_at: upd(1) }];
    expect(await evaluate("approval-sla-breach", mem({ approval: rows }), NOW)).toMatchObject({ value: 1, breached: true, ids: ["e1"] });
  });
  it("message-send-failures counts failed customer messages only", async () => {
    const rows = [{ id: "m", kind: "customer_message", status: "failed", updated_at: upd(10) }, { id: "d", kind: "discount", status: "failed", updated_at: upd(10) }];
    expect(await evaluate("message-send-failures", mem({ approval: rows }), NOW)).toMatchObject({ value: 1, ids: ["m"], breached: true });
    expect((await evaluate("message-send-failures", mem({ approval: [rows[1]!] }), NOW)).breached).toBe(false);
  });
  it("falls back to created_at when updated_at is absent", async () => {
    expect((await evaluate("voice-log-failures", mem({ voice_log: ["a", "b", "c", "d"].map((id) => ({ id, status: "failed", created_at: upd(2) })) }), NOW)).value).toBe(4);
  });
});

describe("previsit-brief-missed", () => {
  const visit = (id: string, startedMin: number) => ({ id, planned_start_at: ago(startedMin + 5), started_at: ago(startedMin) });
  it("a started planned visit without a sent brief is missed; one with a brief sent before the start is not", async () => {
    const r = await evaluate("previsit-brief-missed", mem({
      visit: [visit("v1", 30), visit("v2", 30), visit("v3", 30), { id: "unplanned", planned_start_at: null, started_at: ago(10) }],
      visit_brief: [{ id: "b1", visit_id: "v1", status: "sent", sent_at: ago(45) }, { id: "b2", visit_id: "v2", status: "generated", sent_at: null }, { id: "b3", visit_id: "v3", status: "sent", sent_at: ago(5) }],
    }), NOW);
    expect(r).toMatchObject({ value: 2, samples: 3, breached: true });
    expect(r.ids.sort()).toEqual(["v2", "v3"]);
  });
  it("nothing started -> 0", async () => {
    expect(await evaluate("previsit-brief-missed", mem({ visit: [] }), NOW)).toMatchObject({ value: 0, breached: false });
  });
});

describe("debrief-confirm-latency (p95 > 60 s over 1 h)", () => {
  it("joins the confirmation to its voice log", async () => {
    const tables = {
      voice_log: [{ id: "v1", processed_at: ago(30) }, { id: "v2", processed_at: ago(20) }],
      debrief_confirmation: [{ id: "c1", voice_log_id: "v1", sent_at: new Date(NOW - 30 * 60_000 + 20_000).toISOString() }, { id: "c2", voice_log_id: "v2", sent_at: new Date(NOW - 20 * 60_000 + 90_000).toISOString() }],
    };
    expect(await evaluate("debrief-confirm-latency", mem(tables), NOW)).toMatchObject({ value: 90_000, breached: true, ids: ["c2"], samples: 2 });
    expect((await evaluate("debrief-confirm-latency", mem({ ...tables, debrief_confirmation: [tables.debrief_confirmation[0]!] }), NOW)).breached).toBe(false);
  });
});

describe("cron entry", () => {
  const slow = { voice_log: [{ id: "slow", processing_ms: 45_000, processed_at: ago(1), status: "completed", full_name_never_logged: "x" }] };
  it("fails the run on a breach with a message carrying numbers and ids only", async () => {
    const err = await handle({ tables: api(slow), data: { now: NOW } }, "debrief-latency").catch((e) => e);
    expect(err).toBeInstanceOf(MonitorBreach);
    expect(err.message).toBe("MERC_MONITOR_BREACH debrief-latency: 45000 ms > 20000 (samples 1, ids slow)");
  });
  it("returns the evaluation when healthy", async () => {
    expect(await handle({ tables: api({}), data: { now: NOW } }, "voice-log-failures")).toMatchObject({ key: "voice-log-failures", breached: false });
  });
  it("a drill: rows injected through cron params breach without touching tables, and say so", async () => {
    const err = await handle({ tables: api({}), data: { now: NOW, inject_rows: { voice_log: [{ processing_ms: 45_000 }] } } }, "debrief-latency").catch((e) => e);
    expect(err).toBeInstanceOf(MonitorBreach);
    expect(err.message).toBe("MERC_MONITOR_BREACH debrief-latency: 45000 ms > 20000 (samples 1, ids synthetic-1)");
    // injected ids cannot impersonate real rows; malformed params are ignored
    const r = await handle({ tables: api({}), data: { now: NOW, inject_rows: { voice_log: [{ id: "real-id", processing_ms: 100 }] } } }, "debrief-latency");
    expect(r.ids).toEqual([]);
    expect((await handle({ tables: api({}), data: { now: NOW, inject_rows: "junk" } }, "debrief-latency")).breached).toBe(false);
  });
  it("rejects an unknown key", async () => {
    await expect(handle({ tables: api({}) }, "nope")).rejects.toThrow(/unknown monitor key/);
  });
});

describe("monitor bodies cover platform.json", () => {
  const ids = Object.fromEntries(WATCH_KEYS.map((k) => [watchSlug(k), `id-${k}`]));
  it("every contract monitor has exactly one body, named merc-<key>", () => {
    const keys = Object.keys(contractMonitors());
    expect(keys.length).toBe(7);
    const bodies = allBodies(ids);
    expect(bodies.map((b) => b.name)).toEqual(keys.map((k) => `merc-${k}`));
    for (const b of bodies) expect(b.active).toBe(true);
  });
  it("every watch implements a contract key and quotes it", () => {
    const c = contractMonitors();
    for (const k of WATCH_KEYS) expect(WATCHES[k].contract).toBe(c[k]);
  });
  it("function-errors uses the native API function failure count", () => {
    expect(monitorBody("function-errors", "x", {})).toMatchObject({ metric: "ApiFunctionFailure", resource_type: "api_function", resource_id: null, window_value: 15, time_unit: "Minutes", trigger_conditions: { children: [{ value: FUNCTION_ERRORS_THRESHOLD }] } });
  });
  it("watch monitors are CronFunctionFailure scoped to their cron, window 2x the cron period", () => {
    expect(monitorBody("debrief-latency", "x", ids)).toMatchObject({ metric: "CronFunctionFailure", resource_type: "cron_function", resource_id: "id-debrief-latency", window_value: 10, time_unit: "Minutes" });
    expect(monitorBody("approval-sla-breach", "x", ids)).toMatchObject({ window_value: 2, time_unit: "Hours", severity: "Low" });
  });
  it("refuses a missing cron id or an unknown contract key", () => {
    expect(() => monitorBody("debrief-latency", "x", {})).toThrow(/not deployed/);
    expect(() => monitorBody("brand-new", "x", ids)).toThrow(/no monitor implementation/);
  });
});

describe("generated cron folders are fresh", () => {
  it.each(WATCH_KEYS)("%s", async (k) => {
    const dir = join(OUT, watchSlug(k));
    expect(readFileSync(join(dir, "handler.gen.js"), "utf8")).toBe(await bundleText(k));
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8"))).toEqual(configJson(k));
    const text = readFileSync(join(dir, "handler.gen.js"), "utf8");
    expect(text).not.toMatch(/from\s+["']node:/);
    expect(text).toContain(JSON.stringify(k));
  });
});
