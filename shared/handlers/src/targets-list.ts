// fn:targets-list (contracts/functions/targets-list.json, REQ-TGT-002, scope owner_or_team): sales targets the
// caller may see with progress per contracts/metrics.md#target-progress. Actuals come only from queries
// (REQ-CORE-003); dates are in the org timezone (REQ-CORE-007).
//
// Visibility: user targets of visible users (rep: self, manager: self + team, admin: all), territory targets of
// visible territories, and org targets. With `rep_id` only that rep's own targets (scope checked).
// `period_start` (default: today in the org timezone) selects the targets whose period contains that date.
import {
  daysBetween, defineFunction, invalid, isDate, localDate, today, visibleTerritoryIds,
  dashboardRepIds, type Db, type Impl, type Principal, type Row,
} from "../../core/src/index";
import type { FunctionResponseMap } from "../../core/src/generated/contracts/types";
import { between, linesOf, lineTotalMinor, pctOf, repActuals, type Actuals, type Metric } from "./my-performance";

export type TargetProgress = FunctionResponseMap["targets-list"]["items"][number];
export type TargetScope = "user" | "territory" | "org";

export const scopeOf = (t: Pick<Row<"sales_target">, "user_id" | "territory_id">): TargetScope =>
  t.user_id ? "user" : t.territory_id ? "territory" : "org";

const CHUNK = 200;
async function chunked<T>(ids: string[], load: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await load(ids.slice(i, i + CHUNK))));
  return out;
}

/** metrics.md#target-progress actuals over a set of accounts (territory scope: accounts in it; org: all accounts). */
export async function accountsActuals(db: Db, me: Principal, accounts: Row<"account">[], from: string, to: string): Promise<Actuals> {
  const ids = accounts.map((a) => a.id);
  const orders = await chunked(ids, (part) => db.sales_order.all({ account_id: part, status: "confirmed" }, { and: between("order_date", from, to) }));
  const lines = await linesOf(db, orders.map((o) => o.id));
  const visits = (await chunked(ids, (part) => db.visit.all({ account_id: part, status: "done" }))).filter((v) => {
    const d = v.completed_at ? localDate(me.org, v.completed_at) : v.planned_date;
    return !!d && d >= from && d <= to;
  });
  return {
    revenue: lines.reduce((s, l) => s + lineTotalMinor(l), 0),
    volume: lines.reduce((s, l) => s + l.quantity, 0),
    visits: visits.length,
    new_customers: accounts.filter((a) => !!a.customer_since && a.customer_since >= from && a.customer_since <= to).length,
  };
}

/** Actuals of one target over its own period and scope. */
export async function targetActuals(db: Db, me: Principal, t: Row<"sales_target">): Promise<Actuals> {
  const s = scopeOf(t);
  if (s === "user") return repActuals(db, me, t.user_id!, t.period_start, t.period_end);
  const accounts = s === "territory" ? await db.account.all({ territory_id: t.territory_id! }) : await db.account.all();
  return accountsActuals(db, me, accounts, t.period_start, t.period_end);
}

/** Progress rows for the given targets (actuals cached per scope + period). */
export async function progressOf(db: Db, me: Principal, targets: Row<"sales_target">[], day: string): Promise<TargetProgress[]> {
  const cache = new Map<string, Actuals>();
  const out: TargetProgress[] = [];
  for (const t of targets) {
    const k = `${t.user_id ?? ""}|${t.territory_id ?? ""}|${t.period_start}|${t.period_end}`;
    if (!cache.has(k)) cache.set(k, await targetActuals(db, me, t));
    const actual = cache.get(k)![t.metric as Metric];
    out.push({
      target_id: t.id, metric: t.metric as Metric, period_start: t.period_start, period_end: t.period_end,
      target_value: t.target_value, actual_value: actual, pct: pctOf(actual, t.target_value),
      days_left: Math.max(0, daysBetween(day, t.period_end)),
    });
  }
  return out;
}

const SCOPE_ORDER: Record<TargetScope, number> = { user: 0, territory: 1, org: 2 };

export interface TargetsListDeps { now?: () => number }
export function makeImpl(deps: TargetsListDeps = {}): Impl<"targets-list"> {
  return async ({ req, db, me }) => {
    const day = today(me.org, deps.now?.() ?? Date.now());
    const on = req.period_start ?? day;
    if (!isDate(on)) throw invalid("period_start must be YYYY-MM-DD", { field: "period_start" });

    const active = (await db.sales_target.all({}, { and: [{ column: "period_start", operator: "lte", value: on }, { column: "period_end", operator: "gte", value: on }] }));
    let visible: Row<"sales_target">[];
    if (req.rep_id) {
      dashboardRepIds(me, req.rep_id); // forbidden when the rep is outside the caller's scope (REQ-CORE-009)
      visible = active.filter((t) => t.user_id === req.rep_id);
    } else {
      const users = dashboardRepIds(me), terr = visibleTerritoryIds(me);
      visible = active.filter((t) => {
        const s = scopeOf(t);
        if (s === "user") return users === null || users.includes(t.user_id!);
        if (s === "territory") return terr === null || terr.includes(t.territory_id!);
        return true;
      });
    }
    visible.sort((a, b) => SCOPE_ORDER[scopeOf(a)] - SCOPE_ORDER[scopeOf(b)]
      || (a.user_id ?? a.territory_id ?? "").localeCompare(b.user_id ?? b.territory_id ?? "")
      || a.period_start.localeCompare(b.period_start) || a.metric.localeCompare(b.metric) || a.id.localeCompare(b.id));
    return { items: await progressOf(db, me, visible, day) };
  };
}
export const impl = makeImpl();

/** Wonderful Function entry (functions/targets-list/index.ts calls this). */
export const handle = defineFunction("targets-list", impl);
