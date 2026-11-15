// fn:metrics-rollup (contracts/functions/metrics-rollup.json, REQ-ALR-003). Cron "15 * * * *".
// Rebuilds tbl:account_metrics for every account of the org, exactly as contracts/metrics.md says:
//   #usual-frequency  avg_order_interval_days = median gap of distinct confirmed order dates in the last 180 days
//                     (fewer than 3 dates: account.visit_frequency_days ?? category default ?? 14)
//   #risk             order_gap / competitor / open_problem / no_visit, capped at 100
// All dates are in the organization timezone (REQ-CORE-007).
import { addDays, daysBetween, defineCron, localDate, today, type Db, type FunctionContext, type Impl, type Principal, type Row } from "../../core/src/index";

export const WINDOW_DAYS = 180;
export const FALLBACK_INTERVAL_DAYS = 14;
const DAY_MS = 86_400_000;

/** Run `f` over `ids` in chunks (platform `in` filters stay small). */
export async function inChunks<T>(ids: readonly string[], f: (chunk: string[]) => Promise<T[]>, size = 200): Promise<T[]> {
  const out: T[] = [];
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += size) out.push(...(await f(uniq.slice(i, i + size))));
  return out;
}

/** Platform system column (ms or s epoch, or ISO string) -> epoch ms, or null. */
export function epochMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && v.trim()) {
    if (/^\d+$/.test(v.trim())) return epochMs(Number(v.trim()));
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export function median(xs: readonly number[]): number {
  if (!xs.length) throw new Error("median of nothing");
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface MetricsInput {
  today: string;
  account: Pick<Row<"account">, "id" | "visit_frequency_days" | "category_id">;
  categoryDefault: number | null;
  /** order_date of every confirmed order of the account (any order, duplicates allowed). */
  confirmedOrderDates: string[];
  /** Local dates of done visits. */
  doneVisitDates: string[];
  /** Competitor signals of the account observed in the last 30 days. */
  recentSignals: number;
  /** Open (not resolved) problems created more than 7 days ago. */
  oldOpenProblems: number;
}
export interface AccountMetrics {
  avg_order_interval_days: number;
  last_order_date: string | null;
  days_since_last_order: number | null;
  last_visit_date: string | null;
  risk_score: number;
  risk_reasons: string | null;
}

/** metrics.md #usual-frequency and #risk for one account (pure). */
export function computeMetrics(i: MetricsInput): AccountMetrics {
  const all = [...new Set(i.confirmedOrderDates)].sort();
  const from = addDays(i.today, -WINDOW_DAYS);
  const dates = all.filter((d) => d >= from && d <= i.today);
  const avg = dates.length < 3
    ? i.account.visit_frequency_days ?? i.categoryDefault ?? FALLBACK_INTERVAL_DAYS
    : median(dates.slice(1).map((d, k) => daysBetween(dates[k]!, d)));
  // last_order_date is the latest confirmed order at all (the column is not windowed); null when none.
  const past = all.filter((d) => d <= i.today);
  const last_order_date = past.length ? past[past.length - 1]! : null;
  const days_since_last_order = last_order_date ? daysBetween(last_order_date, i.today) : null;
  const visits = [...new Set(i.doneVisitDates)].filter((d) => d <= i.today).sort();
  const last_visit_date = visits.length ? visits[visits.length - 1]! : null;

  let r = 0;
  const reasons: string[] = [];
  if (days_since_last_order !== null && avg > 0) {
    const ratio = days_since_last_order / avg;
    if (ratio >= 1.5) { r += Math.min(60, Math.round(40 * (ratio - 1))); reasons.push("order_gap"); }
  }
  if (i.recentSignals > 0) { r += 20; reasons.push("competitor"); }
  if (i.oldOpenProblems > 0) { r += 10; reasons.push("open_problem"); }
  // "last visit older than 2 x avg": an account never visited counts as older.
  if (last_visit_date === null || daysBetween(last_visit_date, i.today) > 2 * avg) { r += 10; reasons.push("no_visit"); }
  return { avg_order_interval_days: avg, last_order_date, days_since_last_order, last_visit_date, risk_score: Math.min(100, r), risk_reasons: reasons.length ? reasons.join("|") : null };
}

export interface RollupDeps { now?: () => number }

/** Metrics for every account of the org (no writes). */
export async function computeOrgMetrics(db: Db, me: Principal, now: number): Promise<Map<string, AccountMetrics>> {
  const day = today(me.org, now);
  const accounts = await db.account.all({}, { cap: 20_000 });
  const ids = accounts.map((a) => a.id);
  const cats = new Map((await db.account_category.all()).map((c) => [c.id, c.default_visit_frequency_days ?? null]));
  const orders = await inChunks(ids, (c) => db.sales_order.all({ account_id: c, status: "confirmed" }, { cap: 50_000 }));
  const visits = await inChunks(ids, (c) => db.visit.all({ account_id: c, status: "done" }, { cap: 50_000 }));
  const since30 = new Date(now - 30 * DAY_MS).toISOString();
  const signals = await inChunks(ids, (c) => db.competitor_signal.all({ account_id: c, observed_at: { op: "gte", value: since30 } }));
  const problems = await inChunks(ids, (c) => db.problem.all({ account_id: c, status: ["open", "in_progress"] }));
  const group = <T extends { account_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(r.account_id) ?? m.set(r.account_id, []).get(r.account_id)!).push(r);
    return m;
  };
  const o = group(orders), v = group(visits), s = group(signals), p = group(problems);
  const sevenDaysAgo = now - 7 * DAY_MS;
  const out = new Map<string, AccountMetrics>();
  for (const a of accounts) {
    out.set(a.id, computeMetrics({
      today: day,
      account: a,
      categoryDefault: a.category_id ? cats.get(a.category_id) ?? null : null,
      confirmedOrderDates: (o.get(a.id) ?? []).map((x) => x.order_date),
      doneVisitDates: (v.get(a.id) ?? []).map((x) => (x.completed_at ? localDate(me.org, x.completed_at) : x.planned_date)),
      recentSignals: (s.get(a.id) ?? []).filter((x) => Date.parse(x.observed_at) <= now).length,
      oldOpenProblems: (p.get(a.id) ?? []).filter((x) => { const t = epochMs(x.created_at); return t !== null && t < sevenDaysAgo; }).length,
    }));
  }
  return out;
}

export function makeImpl(deps: RollupDeps = {}): Impl<"metrics-rollup", Principal> {
  return async ({ req, db, me }) => {
    const now = (deps.now ?? Date.now)();
    const metrics = await computeOrgMetrics(db, me, now);
    const ids = [...metrics.keys()];
    const existing = new Map((await inChunks(ids, (c) => db.account_metrics.all({ account_id: c }, { cap: 50_000 }))).map((m) => [m.account_id, m]));
    const computed_at = new Date(now).toISOString();
    let created = 0, updated = 0, unchanged = 0;
    const dry = req.dry_run === true;
    for (const [account_id, m] of metrics) {
      const cur = existing.get(account_id);
      if (!cur) { if (!dry) await db.account_metrics.insert({ account_id, ...m, computed_at }); created++; continue; }
      const same = (Object.keys(m) as (keyof AccountMetrics)[]).every((k) => (cur[k] ?? null) === m[k]);
      if (same) unchanged++;
      if (!dry) await db.account_metrics.update(cur.id, { ...m, computed_at });
      updated++;
    }
    return { processed: metrics.size, created, details: { updated, unchanged, dry_run: dry, today: today(me.org, now) } };
  };
}

export const impl = makeImpl();

/** Cron params arrive in context.data (or params); only the contract key `dry_run` is kept. */
export function cronData(context: { data?: unknown; params?: unknown }): { dry_run?: boolean | null } {
  const raw = (context.data ?? context.params ?? {}) as Record<string, unknown>;
  return raw && typeof raw === "object" && "dry_run" in raw ? { dry_run: raw.dry_run as boolean | null } : {};
}

export const handle = (context: FunctionContext & { params?: unknown }) => defineCron("metrics-rollup", impl)({ ...context, data: cronData(context) });
