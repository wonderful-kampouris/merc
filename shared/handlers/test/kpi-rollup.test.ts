import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsSystem, validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { dailyCounts, handle, loadFacts, makeImpl, savedEvents, snapshot, within1h, workingDays, type Facts } from "../src/kpi-rollup";

// ---- seed fixtures (demo day 2026-11-16) ----
import { runAsSystem as _runAsSystem } from "../../core/src/index";
import { kit as _kit, IDS as _IDS } from "../src/_lib/testkit";
import { makeImpl as _metricsRollup } from "../src/metrics-rollup";
/** Demo day 2026-11-16, 10:00 Athens (UTC+2 in November). */
const NOW = Date.parse("2026-11-16T08:00:00Z");
const FROM = "2026-10-17"; // go-live (seed @D-30)
const TO = "2026-11-16";
const AROMA = "94cc0e65-3b44-5d48-b419-32e51aa11446";
const BLUEBEAN = "8fac56e5-0862-50b1-b242-bb37ac0c98e1";
const MARIA = _IDS.center_rep;
const GIORGOS = "51f64164-9fae-56a4-a1d2-46b24def92e8";
const REPS = [_IDS.nikos, _IDS.dimitra, MARIA, GIORGOS];

/** A seeded kit whose account_metrics were rebuilt by fn:metrics-rollup at NOW (what dev has after the hourly cron). */
async function seededKit() {
  const t = _kit();
  await _runAsSystem("metrics-rollup", _metricsRollup({ now: () => NOW }), { tables: t.tables, data: {}, orgId: _IDS.org });
  return t;
}

/** Hand query: confirmed revenue of the reps between from..to (metrics.md#target-progress revenue). */
async function handRevenue(t: ReturnType<typeof _kit>, reps: string[], from: string, to: string): Promise<number> {
  let total = 0;
  for (const o of await t.db.sales_order.all({ status: "confirmed" })) {
    if (!reps.includes(o.rep_id) || o.order_date < from || o.order_date > to) continue;
    for (const l of await t.db.order_line.all({ order_id: o.id })) total += Math.round(l.quantity * l.unit_price_minor * (1 - (l.discount_pct ?? 0) / 100));
  }
  return total;
}

const run = (t: ReturnType<typeof kit>, data: unknown = {}) => runAsSystem("kpi-rollup", makeImpl({ now: () => NOW }), { tables: t.tables, data, orgId: IDS.org });
const YESTERDAY = "2026-11-15";

describe("fn:kpi-rollup (REQ-DSH-001/004, metrics.md)", () => {
  it("writes one kpi_daily row per active rep for yesterday, then updates it (idempotent)", async () => {
    const t = await seededKit();
    const out = ok(await run(t));
    expect(validateResponse("kpi-rollup", out).ok).toBe(true);
    expect(out).toMatchObject({ processed: 4, created: 4, details: { day: YESTERDAY, updated: 0 } });
    const rows = await t.db.kpi_daily.all({ day: YESTERDAY });
    expect(rows.map((r) => r.rep_id).sort()).toEqual([...REPS].sort());
    const again = ok(await run(t));
    expect(again).toMatchObject({ processed: 4, created: 0, details: { updated: 4 } });
    expect((await t.db.kpi_daily.all({ day: YESTERDAY })).length).toBe(4);
  });

  it("each row matches a hand query of the live tables for that rep and day", async () => {
    const t = await seededKit();
    ok(await run(t));
    for (const rep of REPS) {
      const row = (await t.db.kpi_daily.findOne({ rep_id: rep, day: YESTERDAY }))!;
      const done = (await t.db.visit.all({ rep_id: rep, status: "done" })).filter((v) => (v.completed_at ? new Date(Date.parse(v.completed_at) + 2 * 3600e3).toISOString().slice(0, 10) : v.planned_date) === YESTERDAY);
      expect(row.visits_done).toBe(done.length);
      let rev = 0;
      for (const o of await t.db.sales_order.all({ rep_id: rep, status: "confirmed", order_date: YESTERDAY })) for (const l of await t.db.order_line.all({ order_id: o.id })) rev += Math.round(l.quantity * l.unit_price_minor * (1 - (l.discount_pct ?? 0) / 100));
      expect(row.revenue_minor).toBe(rev);
      const open = (await t.db.deal.all({ owner_id: rep })).filter((d) => ["new", "qualified", "proposal", "negotiation"].includes(d.stage_code));
      expect(row.pipeline_amount_minor).toBe(open.reduce((s, d) => s + (d.amount_minor ?? 0), 0));
    }
  });

  it("dry_run computes without writing; the contract rejects unknown fields", async () => {
    const t = await seededKit();
    const out = ok(await run(t, { dry_run: true }));
    expect(out.created).toBe(4);
    expect((out.details as any).rows).toHaveLength(4);
    expect(await t.db.kpi_daily.count()).toBe(0);
    expect(validateRequest("kpi-rollup", { dry_run: null }).ok).toBe(true);
    expect(validateRequest("kpi-rollup", { bogus: 1 }).ok).toBe(false);
  });

  it("the cron entry runs once per organization with a system principal", async () => {
    const t = await seededKit();
    const out: any = await handle({ tables: t.tables, data: { dry_run: true }, metadata: {} } as any);
    expect(out).toMatchObject({ slug: "kpi-rollup", orgs: 1, failed: 0 });
  });

  it("counts voice logs within 1h, AI actions, approvals, discounts and saved customers (pure engine)", async () => {
    const t = await seededKit();
    const me = await t.system();
    const f: Facts = await loadFacts(t.db, me, [IDS.nikos], NOW);
    const visit = { id: "v1", account_id: "a1", rep_id: IDS.nikos, origin: "plan", planned_date: YESTERDAY, status: "done", completed_at: "2026-11-15T09:00:00Z" } as any;
    f.visits = [visit];
    f.voiceLogs = [
      { id: "l1", rep_id: IDS.nikos, visit_id: "v1", recorded_at: "2026-11-15T09:30:00Z", status: "completed", created_at: Date.parse("2026-11-15T09:30:00Z") },
      { id: "l2", rep_id: IDS.nikos, visit_id: "v1", recorded_at: "2026-11-15T11:00:00Z", status: "completed", created_at: Date.parse("2026-11-15T11:00:00Z") },
      { id: "l3", rep_id: IDS.nikos, visit_id: null, recorded_at: "2026-11-15T12:00:00Z", status: "failed" },
    ] as any;
    f.aiActions = [
      { id: "x1", on_behalf_of: IDS.nikos, status: "applied", applied_at: "2026-11-15T10:00:00Z" },
      { id: "x2", on_behalf_of: IDS.nikos, status: "undone", applied_at: "2026-11-15T10:00:00Z", undone_at: "2026-11-15T10:05:00Z" },
    ] as any;
    f.approvals = [
      { id: "p1", kind: "discount", requested_by: IDS.nikos, status: "approved", decided_at: "2026-11-15T10:00:00Z", created_at: Date.parse("2026-11-15T09:50:00Z") },
      { id: "p2", kind: "customer_message", requested_by: IDS.nikos, status: "rejected", decided_at: "2026-11-15T10:00:00Z" },
    ] as any;
    f.discounts = [{ id: "d1", approval_id: "p1", account_id: "a1", requested_pct: 12, policy_limit_pct: 10, created_at: Date.parse("2026-11-15T09:50:00Z") }] as any;
    f.orders = [{ id: "o1", account_id: "a1", rep_id: IDS.nikos, status: "confirmed", order_date: YESTERDAY }] as any;
    f.orderTotal = new Map([["o1", 5000]]);
    f.goingQuiet = [{ id: "al1", account_id: "a1", alert_type_code: "going_quiet", created_at: Date.parse("2026-11-01T08:00:00Z") }] as any;
    const c = dailyCounts(f, YESTERDAY, YESTERDAY).get(IDS.nikos)!.get(YESTERDAY)!;
    expect(c).toMatchObject({ visits_done: 1, voice_logs: 2, voice_logs_within_1h: 1, ai_actions_applied: 2, ai_actions_undone: 1, approvals_approved: 1, approvals_rejected: 1, discount_requests: 1, discounts_approved: 1, revenue_minor: 5000, customers_saved: 1 });
    expect(savedEvents(f)).toHaveLength(1);
    // an order more than 30 days after the alert does not save the customer
    f.goingQuiet = [{ id: "al2", account_id: "a1", created_at: Date.parse("2026-10-01T08:00:00Z") }] as any;
    expect(savedEvents(f)).toHaveLength(0);
    expect(within1h(f.voiceLogs[0]!, undefined)).toBe(false);
  });

  it("crm completeness follows metrics.md#crm-completeness; weekends do not count as rep days", async () => {
    const t = await seededKit();
    const f = await loadFacts(t.db, await t.system(), [IDS.nikos], NOW);
    const base = snapshot(f).completeness;
    expect(base.pct).toBe(100);
    f.accounts = f.accounts.map((a, i) => (i === 0 && (a.account_type === "customer" || a.account_type === "prospect") ? { ...a, phone: null, email: null } : a));
    const s = snapshot(f).completeness;
    expect(s.incomplete).toHaveLength(1);
    expect(s.incomplete[0]!.missing).toContain("phone_or_email");
    expect(s.pct).toBe(Math.round((1000 * (s.active - 1)) / s.active) / 10);
    expect(workingDays("2026-11-14", "2026-11-16")).toBe(1);
  });

  it("functions/kpi-rollup/handler.gen.js is the current bundle (run `pnpm bundle kpi-rollup` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "kpi-rollup", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("kpi-rollup"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
