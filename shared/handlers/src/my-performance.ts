// fn:my-performance (contracts/functions/my-performance.json, REQ-TGT-002): the caller's own target progress
// (contracts/metrics.md#target-progress) and period numbers, plus a spoken summary built only from them.
// Every number comes from a query (REQ-CORE-003); dates are in the org timezone (REQ-CORE-007).
import {
  daysBetween, defineFunction, invalid, isDate, localDate, monthRange, today, weekRange,
  type Db, type Filter, type Impl, type Principal, type Row,
} from "../../core/src/index";
import type { FunctionResponseMap } from "../../core/src/generated/contracts/types";

type TargetProgress = FunctionResponseMap["my-performance"]["targets"][number];
export type Metric = TargetProgress["metric"];

/** metrics.md#target-progress revenue of one order line: quantity x unit price x (1 - discount/100), in minor units. */
export const lineTotalMinor = (l: { quantity: number; unit_price_minor: number; discount_pct?: number | null }): number =>
  Math.round(l.quantity * l.unit_price_minor * (1 - (l.discount_pct ?? 0) / 100));

export const between = (column: string, from: string, to: string): Filter[] => [
  { column, operator: "gte", value: from },
  { column, operator: "lte", value: to },
];

/** Order lines of the given orders (chunked `in` filters). */
export async function linesOf(db: Db, orderIds: string[]): Promise<Row<"order_line">[]> {
  const out: Row<"order_line">[] = [];
  for (let i = 0; i < orderIds.length; i += 200) out.push(...(await db.order_line.all({ order_id: orderIds.slice(i, i + 200) })));
  return out;
}

export interface Actuals { revenue: number; volume: number; visits: number; new_customers: number }

/** metrics.md#target-progress actuals for one rep (scope = the user) over local dates from..to inclusive. */
export async function repActuals(db: Db, me: Principal, repId: string, from: string, to: string): Promise<Actuals> {
  const orders = await db.sales_order.all({ rep_id: repId, status: "confirmed" }, { and: between("order_date", from, to) });
  const lines = await linesOf(db, orders.map((o) => o.id));
  const visits = (await db.visit.all({ rep_id: repId, status: "done" })).filter((v) => {
    const d = v.completed_at ? localDate(me.org, v.completed_at) : v.planned_date;
    return !!d && d >= from && d <= to;
  });
  const newCustomers = await db.account.all({ owner_rep_id: repId }, { and: between("customer_since", from, to) });
  return {
    revenue: lines.reduce((s, l) => s + lineTotalMinor(l), 0),
    volume: lines.reduce((s, l) => s + l.quantity, 0),
    visits: visits.length,
    new_customers: newCustomers.length,
  };
}

export const pctOf = (actual: number, target: number): number => (target > 0 ? Math.round((1000 * actual) / target) / 10 : 0);

/** Target progress rows for the user's own targets that overlap from..to; actuals over each target's own period. */
export async function targetProgress(db: Db, me: Principal, userId: string, from: string, to: string, day: string): Promise<TargetProgress[]> {
  const targets = (await db.sales_target.all({ user_id: userId }))
    .filter((t) => t.period_start <= to && t.period_end >= from)
    .sort((a, b) => a.period_start.localeCompare(b.period_start) || a.metric.localeCompare(b.metric));
  const cache = new Map<string, Actuals>();
  const out: TargetProgress[] = [];
  for (const t of targets) {
    const k = `${t.period_start}|${t.period_end}`;
    if (!cache.has(k)) cache.set(k, await repActuals(db, me, userId, t.period_start, t.period_end));
    const actual = cache.get(k)![t.metric as Metric];
    out.push({
      target_id: t.id, metric: t.metric as Metric, period_start: t.period_start, period_end: t.period_end,
      target_value: t.target_value, actual_value: actual, pct: pctOf(actual, t.target_value),
      days_left: Math.max(0, daysBetween(day, t.period_end)),
    });
  }
  return out;
}

export function periodRange(me: Principal, req: { period: "week" | "month" | "custom"; from?: string | null; to?: string | null }, day: string): { from: string; to: string } {
  if (req.period === "week") { const r = weekRange(me.org, day); return { from: r.fromDate, to: r.toDate }; }
  if (req.period === "month") { const r = monthRange(me.org, day); return { from: r.fromDate, to: r.toDate }; }
  if (!req.from || !req.to || !isDate(req.from) || !isDate(req.to)) throw invalid("period custom needs from and to (YYYY-MM-DD)", { field: "from/to" });
  if (req.from > req.to) throw invalid("from must be on or before to", { from: req.from, to: req.to });
  return { from: req.from, to: req.to };
}

/** Money in major units with 2 decimals, e.g. 2150 -> "21.50". */
export const money = (minor: number): string => (minor / 100).toFixed(2);

const WORDS = {
  en: {
    week: "This week", month: "This month", custom: (f: string, t: string) => `From ${f} to ${t}`,
    metric: { revenue: "revenue", volume: "volume", visits: "visits", new_customers: "new customers" } as Record<Metric, string>,
    target: (m: string, a: string, tv: string, p: number, d: number) => `${m} ${a} of ${tv} (${p}%), ${d} days left.`,
    totals: (v: number, r: string, n: number) => `Visits done ${v}, revenue ${r}, new customers ${n}.`,
    none: "No targets set for this period.",
  },
  el: {
    week: "Αυτή την εβδομάδα", month: "Αυτόν τον μήνα", custom: (f: string, t: string) => `Από ${f} έως ${t}`,
    metric: { revenue: "τζίρος", volume: "όγκος", visits: "επισκέψεις", new_customers: "νέοι πελάτες" } as Record<Metric, string>,
    target: (m: string, a: string, tv: string, p: number, d: number) => `${m} ${a} από ${tv} (${p}%), μένουν ${d} μέρες.`,
    totals: (v: number, r: string, n: number) => `Επισκέψεις ${v}, τζίρος ${r}, νέοι πελάτες ${n}.`,
    none: "Δεν υπάρχουν στόχοι για αυτή την περίοδο.",
  },
};

/** Spoken summary from the computed numbers only, in the user's language (el default, REQ-CORE-012). */
export function spokenSummary(lang: string, period: "week" | "month" | "custom", from: string, to: string, targets: TargetProgress[], a: { visits_done: number; revenue_minor: number; new_customers: number }, currency: string): string {
  const w = lang === "en" ? WORDS.en : WORDS.el;
  const val = (m: Metric, v: number) => (m === "revenue" ? `${money(v)} ${currency}` : String(v));
  const head = period === "custom" ? w.custom(from, to) : w[period];
  const parts = targets.map((t) => w.target(w.metric[t.metric], val(t.metric, t.actual_value), val(t.metric, t.target_value), t.pct, t.days_left));
  return [`${head}:`, ...(parts.length ? parts : [w.none]), w.totals(a.visits_done, `${money(a.revenue_minor)} ${currency}`, a.new_customers)].join(" ");
}

export interface MyPerformanceDeps { now?: () => number }
export function makeImpl(deps: MyPerformanceDeps = {}): Impl<"my-performance"> {
  return async ({ req, db, me }) => {
    const day = today(me.org, deps.now?.() ?? Date.now());
    const { from, to } = periodRange(me, req, day);
    const a = await repActuals(db, me, me.id, from, to);
    const targets = await targetProgress(db, me, me.id, from, to, day);
    const totals = { visits_done: a.visits, revenue_minor: a.revenue, new_customers: a.new_customers };
    const lang = me.user.preferred_language ?? me.org.default_language ?? "el";
    return { targets, ...totals, spoken_summary: spokenSummary(lang, req.period, from, to, targets, totals, me.org.currency ?? "EUR") };
  };
}
export const impl = makeImpl();

/** Wonderful Function entry (functions/my-performance/index.ts calls this). */
export const handle = defineFunction("my-performance", impl);
