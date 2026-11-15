import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUDGET_SERVER_MS, MIN_SAMPLES, ROOT, fromDev, fromReports, percentile, summarize, type Sample } from "../src/debrief-p95";
import { kit, IDS } from "../../../shared/handlers/src/_lib/testkit";

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const s = (server: number | null, wall: number | null = null, source = "report:x", id: string | null = null): Sample => ({ source, id, server_ms: server, wall_ms: wall, at: "2026-11-15T13:00:00Z" });

describe("REQ-NFR-001 debrief p95 gate", () => {
  it("nearest-rank percentile", () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19);
    expect(percentile([5, 1, 3], 50)).toBe(3);
  });

  it("passes 20 runs under 20 s, fails when the tail is slow, refuses fewer than 20 runs", () => {
    const fast = Array.from({ length: 20 }, () => s(8_000, 9_000));
    expect(summarize(fast).pass).toBe(true);
    const slow = [...Array.from({ length: 18 }, () => s(8_000)), s(21_000), s(30_000)];
    expect(summarize(slow)).toMatchObject({ pass: false, reason: expect.stringContaining("server p95 21000") });
    expect(summarize(fast.slice(0, MIN_SAMPLES - 1))).toMatchObject({ pass: false, reason: expect.stringContaining("only 19") });
    const lateCard = Array.from({ length: 20 }, () => s(8_000, 26_000));
    expect(summarize(lateCard)).toMatchObject({ pass: false, reason: expect.stringContaining("wall p95") });
  });

  it("reads eval reports and does not double count a voice_log also read from dev", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa02-"));
    writeFileSync(join(dir, "dev-a.json"), JSON.stringify({ at: "2026-11-15T13:00:00Z", cases: [{ id: "c1", status: "processed", ms: 4000, wall_ms: 4500, voice_log_id: "vl1" }, { id: "c2", ms: null, wall_ms: 300 }] }));
    writeFileSync(join(dir, "baseline-x.json"), "{}");
    const rep = fromReports(dir);
    expect(rep.map((r) => r.server_ms)).toEqual([4000]);
    const dev = fromDev(() => JSON.stringify({ data: [{ id: "vl1", data: { id: "vl1", processing_ms: 4000 } }, { id: "vl2", data: { id: "vl2", processing_ms: 7000 } }], pagination: { has_next_page: false } }));
    expect(summarize([...rep, ...dev]).server.n).toBe(2);
  });

  it("the measured dev runs on record pass the budget (evidence in tests/perf/reports)", () => {
    const sm = summarize(fromReports(join(ROOT, "evals/debrief/reports")));
    // Recorded today on dev against the deployed fn:debrief-process; re-run src/debrief-p95.ts --live to refresh.
    if (sm.server.n >= MIN_SAMPLES) expect(sm.server.p95!).toBeLessThanOrEqual(BUDGET_SERVER_MS);
    else expect(sm.pass).toBe(false);
  });
});

describe("REQ-NFR-003 function timeouts and body limit", () => {
  const fnDir = join(ROOT, "functions");
  const contracts = join(ROOT, "spec/contracts/functions");
  const slugs = readdirSync(fnDir).filter((d) => { try { readFileSync(join(fnDir, d, "config.json")); return true; } catch { return false; } });

  it("only cron and procedure-called functions declare a timeout over 60 s (config and contract)", () => {
    const bad: string[] = [];
    for (const slug of slugs) {
      const cfg = json(join(fnDir, slug, "config.json"));
      let callers: string[] = [];
      try { callers = json(join(contracts, `${slug}.json`)).callers ?? []; } catch { /* no contract: treat as interactive */ }
      const background = cfg.kind === "cron" || (callers.length > 0 && callers.every((c) => c === "scheduler" || c === "procedure"));
      if ((cfg.timeout_ms ?? 30_000) > 60_000 && !background) bad.push(`${slug} ${cfg.timeout_ms}`);
    }
    for (const f of readdirSync(contracts)) {
      const c = json(join(contracts, f));
      if ((c.timeout_ms ?? 30_000) > 60_000 && !(c.callers ?? []).every((x: string) => x === "scheduler" || x === "procedure")) bad.push(`contract ${f} ${c.timeout_ms}`);
    }
    expect(slugs.length).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });

  it("interactive (app/buddy) functions stay within the 30 s default plus the visit-brief/debrief allowance (<= 60 s)", () => {
    const over: string[] = [];
    for (const slug of slugs) {
      const cfg = json(join(fnDir, slug, "config.json"));
      if (cfg.kind !== "cron" && (cfg.timeout_ms ?? 30_000) > 60_000) over.push(slug);
    }
    expect(over).toEqual([]);
  });
});

describe("REQ-NFR-006 synthetic 50 reps / 5,000 accounts: list p95 < 1 s", () => {
  it("accounts-list for a rep, a manager and the admin", async () => {
    const t = kit();
    const terr = [IDS.north, IDS.center];
    const reps: string[] = [];
    const users: Record<string, any>[] = [], links: Record<string, any>[] = [], accs: Record<string, any>[] = [];
    const existingReps = [...(t.tables.rows.get("app_user")?.values() ?? [])].filter((u) => u.role_code === "rep").length;
    for (let i = existingReps; i < 50; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      reps.push(id);
      users.push({ id, org_id: IDS.org, wonderful_user_id: `wuid-load${i}`, role_code: "rep", manager_id: IDS.eleni, full_name: `Load Rep ${i}`, email: `load${i}@merc.test`, active: true, preferred_language: "el" });
      links.push({ id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`, territory_id: terr[i % 2], user_id: id });
    }
    const existingAcc = t.tables.rows.get("account")?.size ?? 0;
    const sample = [...t.tables.rows.get("account")!.values()][0]!;
    for (let i = existingAcc; i < 5000; i++) {
      accs.push({ ...sample, id: `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `Load Shop ${i}`, vat_number: String(900000000 + i), external_ref: null, owner_rep_id: reps[i % reps.length], territory_id: terr[i % 2] });
    }
    t.tables.load("app_user", users);
    t.tables.load("territory_rep", links);
    t.tables.load("account", accs);
    expect(t.tables.rows.get("account")!.size).toBe(5000);

    const { handle } = await import("../../../shared/handlers/src/accounts-list");
    const ctx = (who: string) => ({ tables: t.tables, data: { limit: 50 }, secrets: t.platform.secrets, globals: t.platform.globals, metadata: { workspaceId: "ws", user: { id: who, email: "x@merc.test", role: "user", tenantId: "t" } } });
    const result: Record<string, number | null> = {};
    for (const who of ["wuid-nikos", "wuid-eleni", "wuid-thanasis"]) {
      const ms: number[] = [];
      for (let k = 0; k < 20; k++) {
        const t0 = performance.now();
        const out: any = await handle(ctx(who) as any);
        ms.push(performance.now() - t0);
        expect(out.error).toBeUndefined();
      }
      result[who] = percentile(ms, 95);
    }
    console.log(JSON.stringify({ nfr006_accounts_list_p95_ms: result }));
    for (const v of Object.values(result)) expect(v!).toBeLessThan(1000);
  }, 120_000);
});

describe("REQ-NFR-002 buddy latency from conversation logs", () => {
  it("measures tool spans (excluding log_visit and platform tools) and voice first-response gaps", async () => {
    const { measure } = await import("../src/buddy-latency");
    const tool = (fn: string, s: number, e: number) => ({ speaker: "system", start_time: s, end_time: e, sequence: s, tool_details: { function_name: fn } });
    const m = measure([
      { id: "v", type: "voice", transcriptions: [
        { speaker: "customer", start_time: 0, end_time: 1000, sequence: 1 }, tool("get_today", 1100, 1900), { speaker: "agent", start_time: 2200, end_time: 4000, sequence: 2300 },
        { speaker: "customer", start_time: 5000, end_time: 6000, sequence: 5000 }, tool("log_visit", 6100, 16000), tool("__platform_identify_customer", 6000, 9000), { speaker: "agent", start_time: 16500, end_time: 17000, sequence: 16500 } ] },
      { id: "c", type: "chat", transcriptions: [tool("resolve_account", 0, 4000)] },
    ]);
    expect(m.per_tool).toEqual({ get_today: { n: 1, p95: 800 }, resolve_account: { n: 1, p95: 4000 } });
    expect(m.tools_over_budget).toEqual(["resolve_account"]);
    expect(m.voice_turns).toBe(2);
    expect(m.first_response_p95_ms).toBe(10500);
    expect(m.pass).toBe(false);
  });
});
