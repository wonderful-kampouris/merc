import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsSystem, validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, impl, runForOps, STUCK_DAYS } from "../src/summary-data";

const WEEK = { kind: "weekly", from: "2026-11-09", to: "2026-11-15" } as const;
const facts = (out: unknown) => ok(out as any).facts as any;

describe("fn:summary-data", () => {
  it("manager weekly facts: scope = her team, deals won/stuck/coming, live-table fallback when kpi_daily is empty", async () => {
    const t = kit();
    const f = facts(await handle(t.fnCtx("eleni", { ...WEEK, scope_user_id: IDS.eleni })));
    expect(f.recipient).toMatchObject({ name: "Eleni Markou", role: "manager", email: "eleni@merc-demo.example" });
    expect(f.scope.rep_count).toBe(4);
    expect(f.kpi.source).toBe("live_tables");
    expect(f.days).toBe(7);
    // Barista milk switch: no activity since @D-20 (>= 14 days); Syrups line: close date @D-5 already passed.
    expect(f.deals.stuck.map((d: any) => d.title).sort()).toEqual(["Barista milk switch", "Decaf line", "Syrups line"]);
    expect(f.deals.coming.map((d: any) => d.title)).toEqual(["Q4 coffee offer", "Espresso Nuovo trial", "Espresso 20kg monthly", "New espresso", "Cups annual", "Flour contract"]);
    expect(f.deals.won_count).toBe(0);
    expect(f.deals.open_count).toBe(13);
    expect(typeof f.deals.weighted_pipeline).toBe("string");
    expect(f.deals.weighted_pipeline).toMatch(/ EUR$/);
    expect(f.monthly).toBeUndefined();
    expect(STUCK_DAYS).toBe(14);
  });

  it("uses kpi_daily sums when the rollup has rows for the period", async () => {
    const t = kit();
    await t.db.kpi_daily.insert({ rep_id: IDS.nikos, day: "2026-11-10", visits_done: 5, voice_logs: 4, voice_logs_within_1h: 3, new_customers: 1, ai_actions_applied: 2, ai_actions_undone: 0, approvals_approved: 1, approvals_rejected: 0, pipeline_amount_minor: 100, weighted_pipeline_minor: 50, revenue_minor: 120000, crm_completeness_pct: 80, customers_saved: 1, discount_requests: 2, discounts_approved: 1 } as any);
    await t.db.kpi_daily.insert({ rep_id: IDS.dimitra, day: "2026-11-10", visits_done: 3, voice_logs: 3, voice_logs_within_1h: 3, new_customers: 0, ai_actions_applied: 0, ai_actions_undone: 0, approvals_approved: 0, approvals_rejected: 0, pipeline_amount_minor: 0, weighted_pipeline_minor: 0, revenue_minor: 30000, crm_completeness_pct: 60, customers_saved: 0, discount_requests: 0, discounts_approved: 0 } as any);
    const f = facts(await handle(t.fnCtx("thanasis", { ...WEEK, scope_user_id: IDS.thanasis })));
    expect(f.kpi).toMatchObject({ source: "kpi_daily", days_with_data: 1, visits_done: 8, revenue_minor: 150000, revenue: "1500.00 EUR", customers_saved: 1, crm_completeness_pct: 70 });
    expect(f.per_rep.find((r: any) => r.name === "Nikos Alexiou")).toMatchObject({ visits_done: 5, revenue_minor: 120000 });
  });

  it("monthly facts carry before/after baseline, completeness, new customers, customers saved", async () => {
    const t = kit();
    const f = facts(await handle(t.fnCtx("thanasis", { kind: "monthly", scope_user_id: IDS.thanasis, from: "2026-10-01", to: "2026-10-31" })));
    expect(f.monthly).toHaveProperty("before_after");
    expect(f.monthly.before_after.baseline.from).toBe("2026-07-19"); // @D-120
    expect(f.monthly.before_after.after.from).toBe("2026-10-17"); // @D-30 go-live
    expect(f.monthly).toHaveProperty("customers_saved");
    expect(f.monthly).toHaveProperty("new_customers");
    expect(f.monthly).toHaveProperty("crm_completeness_pct");
  });

  it("scope (REQ-CORE-009): a rep cannot read the manager's summary, but can read their own", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", { ...WEEK, scope_user_id: IDS.eleni })))).toBe("forbidden");
    expect(facts(await handle(t.fnCtx("nikos", { ...WEEK, scope_user_id: IDS.nikos }))).scope.rep_count).toBe(1);
    expect(errCode(await handle(t.fnCtx(null, { ...WEEK, scope_user_id: IDS.eleni })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("eleni", { ...WEEK, scope_user_id: "00000000-0000-4000-8000-000000000000" })))).toBe("forbidden");
  });

  it("a spoofed caller in the body is ignored; bad periods are refused", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", { ...WEEK, scope_user_id: IDS.eleni, caller: IDS.thanasis })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("eleni", { ...WEEK, from: "2026-11-15", to: "2026-11-09", scope_user_id: IDS.eleni })))).toBe("validation_failed");
  });

  it("merc-ops tool path (runForOps) gives the same facts as the app path", async () => {
    const t = kit();
    const viaApp = facts(await handle(t.fnCtx("eleni", { ...WEEK, scope_user_id: IDS.eleni })));
    const viaTool = facts(await runForOps(t.tables, { ...WEEK, scope_user_id: IDS.eleni }));
    expect(viaTool).toEqual(viaApp);
    expect(errCode(await runForOps(t.tables, { ...WEEK, scope_user_id: "00000000-0000-4000-8000-000000000000" }))).toBe("forbidden");
    const sys = await runAsSystem("summary-data", impl, { tables: t.tables, data: { ...WEEK, scope_user_id: IDS.eleni }, orgId: IDS.org, caller: "procedure" });
    expect(facts(sys)).toEqual(viaApp);
  });

  it("contract: request and response validate", async () => {
    const t = kit();
    expect(validateRequest("summary-data", { ...WEEK, scope_user_id: IDS.eleni }).ok).toBe(true);
    expect(validateRequest("summary-data", { ...WEEK }).ok).toBe(false);
    expect(validateRequest("summary-data", { ...WEEK, kind: "daily", scope_user_id: IDS.eleni }).ok).toBe(false);
    expect(validateResponse("summary-data", ok(await handle(t.fnCtx("eleni", { ...WEEK, scope_user_id: IDS.eleni })))).ok).toBe(true);
  });

  it("functions/summary-data/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "summary-data", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("summary-data"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
