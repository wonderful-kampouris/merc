// fn:dashboard-kpis (contracts/functions/dashboard-kpis.json, REQ-DSH-001, REQ-DSH-004). Gate dashboard.read, scope dashboard.
// The KpiSet for a period, territory and rep, plus the same figures per rep. Event counts per rep per day come from
// tbl:kpi_daily for days the rollup has written (before today) and from the live tables otherwise; point-in-time
// figures (pipeline, at risk, lost, completeness) and target progress are live. With compare_baseline, `kpis.baseline`
// holds the same metrics over baseline_start .. go_live_date and the same-length period after go-live
// (metrics.md#before-after). Every number comes from a query (REQ-CORE-003).
import { addDays, daysBetween, defineFunction, type Db, type Impl, type Principal, type Row } from "../../core/src/index";
import type { FunctionResponseMap } from "../../core/src/generated/contracts/types";
import { inChunks } from "./metrics-rollup";
import { targetProgress } from "./my-performance";
import {
  addCounts, checkRange, dailyCounts, loadFacts, pct, resolveReps, snapshot, workingDays, zeroCounts,
  type DayCounts, type Facts,
} from "./kpi-rollup";

type KpiSet = FunctionResponseMap["dashboard-kpis"]["kpis"];
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Summed counts per rep over from..to: kpi_daily rows for days before today, live counts for the rest. */
export async function periodCounts(db: Db, f: Facts, repIds: string[], from: string, to: string): Promise<{ perRep: Map<string, DayCounts>; stored: Row<"kpi_daily">[] }> {
  const live = dailyCounts(f, from, to);
  const stored = (await inChunks(repIds, (c) => db.kpi_daily.all({ rep_id: c }, { and: [{ column: "day", operator: "gte", value: from }, { column: "day", operator: "lte", value: to }], cap: 50_000 })))
    .filter((r) => r.day < f.today);
  const storedKey = new Map(stored.map((r) => [`${r.rep_id}|${r.day}`, r]));
  const perRep = new Map<string, DayCounts>();
  for (const id of repIds) {
    const acc = zeroCounts();
    const liveDays = live.get(id) ?? new Map<string, DayCounts>();
    for (const r of stored) if (r.rep_id === id) addCounts(acc, r);
    for (const [day, c] of liveDays) if (!storedKey.has(`${id}|${day}`)) addCounts(acc, c);
    perRep.set(id, acc);
  }
  return { perRep, stored };
}

const sum = (xs: Iterable<DayCounts>): DayCounts => { const a = zeroCounts(); for (const x of xs) addCounts(a, x); return a; };

/** Rate and count KPIs from summed counts (the KpiSet fields that come from events). */
export function eventKpis(c: DayCounts, reps: number, from: string, to: string) {
  const repDays = Math.max(1, reps) * workingDays(from, to);
  return {
    visits_per_rep_day: round1(c.visits_done / repDays),
    revenue_minor: c.revenue_minor,
    new_customers: c.new_customers,
    customers_saved: c.customers_saved,
    voice_logs_per_rep_day: round1(c.voice_logs / repDays),
    voice_logs_within_1h_pct: pct(c.voice_logs_within_1h, c.voice_logs),
    ai_actions_applied: c.ai_actions_applied,
    ai_actions_undone: c.ai_actions_undone,
    approvals_approved: c.approvals_approved,
    approvals_rejected: c.approvals_rejected,
    discount_requests: c.discount_requests,
    discounts_approved: c.discounts_approved,
  };
}

/** metrics.md#before-after: event KPIs before and after go-live, plus stored completeness/pipeline averages. */
export async function baselineOf(db: Db, me: Principal, f: Facts, repIds: string[]): Promise<Record<string, unknown> | null> {
  const start = me.org.baseline_start, live = me.org.go_live_date;
  if (!start || !live || start >= live) return null;
  const len = daysBetween(start, live); // baseline_start .. day before go-live
  const before = { from: start, to: addDays(live, -1) };
  const afterTo = addDays(live, len - 1) < f.today ? addDays(live, len - 1) : f.today;
  const after = { from: live, to: afterTo };
  const avgStored = (rows: Row<"kpi_daily">[], k: "crm_completeness_pct" | "weighted_pipeline_minor") => {
    const xs = rows.map((r) => r[k]).filter((x): x is number => typeof x === "number");
    return xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  };
  const b = await periodCounts(db, f, repIds, before.from, before.to);
  const a = await periodCounts(db, f, repIds, after.from, after.to);
  const snap = snapshot(f, repIds);
  // Completeness is point-in-time: before = mean of the stored daily values; after = stored mean, or today's live value.
  const afterCompleteness = avgStored(a.stored, "crm_completeness_pct") ?? snap.completeness.pct;
  const imports = (await db.data_import.all({ is_baseline: true })).filter((i) => i.status === "imported");
  return {
    ...eventKpis(sum(b.perRep.values()), repIds.length, before.from, before.to),
    crm_completeness_pct: avgStored(b.stored, "crm_completeness_pct"),
    weighted_pipeline_minor: avgStored(b.stored, "weighted_pipeline_minor"),
    period: before,
    baseline_days_stored: new Set(b.stored.map((r) => r.day)).size,
    baseline_imports: imports.length,
    baseline_rows_imported: imports.reduce((x, i) => x + (i.rows_imported ?? 0), 0),
    after: {
      ...eventKpis(sum(a.perRep.values()), repIds.length, after.from, after.to),
      crm_completeness_pct: afterCompleteness,
      weighted_pipeline_minor: avgStored(a.stored, "weighted_pipeline_minor") ?? snap.weighted_pipeline_minor,
      period: after,
    },
  };
}

/** Full KpiSet of a set of reps over from..to (shared with rep-detail). */
export async function kpiSetFor(db: Db, me: Principal, f: Facts, repIds: string[], from: string, to: string, perRep?: Map<string, DayCounts>): Promise<KpiSet> {
  const counts = perRep ?? (await periodCounts(db, f, repIds, from, to)).perRep;
  const s = snapshot(f, repIds);
  const day = f.today;
  const targets = [];
  for (const id of repIds) targets.push(...(await targetProgress(db, me, id, from, to, day)));
  return {
    ...eventKpis(sum(repIds.map((id) => counts.get(id) ?? zeroCounts())), repIds.length, from, to),
    pipeline_by_stage: s.pipeline_by_stage,
    weighted_pipeline_minor: s.weighted_pipeline_minor,
    at_risk_customers: s.atRisk.length,
    at_risk_value_minor: s.at_risk_value_minor,
    lost_customers: s.lost.length,
    crm_completeness_pct: s.completeness.pct,
    targets,
  };
}

/** The per-rep row of the by-rep table (KpiSet subset without targets/stage list). */
export function repKpis(f: Facts, repId: string, c: DayCounts, from: string, to: string): Record<string, number> {
  const s = snapshot(f, [repId]);
  return {
    ...eventKpis(c, 1, from, to),
    visits_done: c.visits_done,
    voice_logs: c.voice_logs,
    pipeline_amount_minor: s.pipeline_amount_minor,
    weighted_pipeline_minor: s.weighted_pipeline_minor,
    at_risk_customers: s.atRisk.length,
    at_risk_value_minor: s.at_risk_value_minor,
    lost_customers: s.lost.length,
    crm_completeness_pct: s.completeness.pct,
  };
}

export const userRef = (u: Row<"app_user">) => ({ id: u.id, full_name: u.full_name, role: u.role_code as "rep" | "manager" | "admin" });

export function makeImpl(deps: { now?: () => number } = {}): Impl<"dashboard-kpis"> {
  return async ({ req, db, me }) => {
    checkRange(req.from, req.to);
    const now = (deps.now ?? Date.now)();
    const { reps, repIds } = await resolveReps(db, me, req);
    const f = await loadFacts(db, me, repIds, now);
    const { perRep } = await periodCounts(db, f, repIds, req.from, req.to);
    const kpis: KpiSet = await kpiSetFor(db, me, f, repIds, req.from, req.to, perRep);
    if (req.compare_baseline) kpis.baseline = await baselineOf(db, me, f, repIds);
    const by_rep = reps.map((u) => ({ rep: userRef(u), kpis: repKpis(f, u.id, perRep.get(u.id) ?? zeroCounts(), req.from, req.to) }));
    return { kpis, by_rep };
  };
}
export const impl = makeImpl();

/** Wonderful Function entry (functions/dashboard-kpis/index.ts calls this). */
export const handle = defineFunction("dashboard-kpis", impl);

