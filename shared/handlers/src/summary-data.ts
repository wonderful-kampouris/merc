// fn:summary-data (contracts/functions/summary-data.json, REQ-DSH-005): the only source of numbers for the
// merc-ops weekly summary and monthly report. Deterministic facts for one recipient's scope over local dates
// from..to (org timezone, REQ-CORE-007):
//   scope   manager -> their direct + indirect reports, admin -> every active rep of the org, rep -> themself
//   kpi     sums of tbl:kpi_daily over the period (the dashboard rollup). When the period has no kpi_daily rows
//           (rollup not run yet) the same metrics come from the live tables with the metrics.md#target-progress
//           definitions (repActuals), and `kpi.source` says so.
//   deals   won / lost in the period, stuck (open, no activity for STUCK_DAYS or an open deal_stuck alert),
//           coming (open, expected close within COMING_DAYS after `to`), weighted pipeline (metrics.md#weighted-pipeline)
//   alerts  open alerts of the scope by type, alerts created in the period
//   monthly before/after baseline (metrics.md#before-after), CRM completeness, new customers, customers saved
// Every number is computed here, never by an LLM (REQ-CORE-003). Money is minor units plus a display string.
import { isAdmin,
  addDays, dateRange, daysBetween, forbidden, invalid, isDate, localDate, resolvePrincipal,
  type Db, type Impl, type Principal, type Row, type UserPrincipal,
} from "../../core/src/index";
import { createDb, defineFunction, runAsSystem, type PlatformLike, type TablesApi } from "../../core/src/index";
import { money, repActuals, targetProgress } from "./my-performance";

export const STUCK_DAYS = 14; // = seed alert_rule deal_stuck.threshold_value (contracts/seed/alert_rule.json)
export const COMING_DAYS = 14;
export const MAX_PERIOD_DAYS = 400;
const MAX_LIST = 8;

type Kind = "weekly" | "monthly";
export interface KpiTotals {
  source: "kpi_daily" | "live_tables";
  days_with_data: number;
  visits_done: number; voice_logs: number; voice_logs_within_1h: number; new_customers: number;
  revenue_minor: number; revenue: string; customers_saved: number; discount_requests: number; discounts_approved: number;
  approvals_approved: number; approvals_rejected: number; ai_actions_applied: number; ai_actions_undone: number;
  crm_completeness_pct: number | null;
}

const ms = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN);
const sum = <T>(xs: T[], f: (x: T) => number | null | undefined) => xs.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
export const moneyText = (minor: number, currency: string) => `${money(minor)} ${currency}`;

/** The scope a recipient sees: rep ids (and the user rows) of their team. */
export async function scopeReps(db: Db, scope: UserPrincipal): Promise<Row<"app_user">[]> {
  const users = (await db.app_user.all({ status: "active" })).sort((a, b) => a.full_name.localeCompare(b.full_name));
  if (scope.role === "admin") return users.filter((u) => u.role_code === "rep");
  if (scope.role === "manager") return users.filter((u) => scope.team_user_ids.includes(u.id) && u.role_code === "rep");
  return users.filter((u) => u.id === scope.id);
}

async function kpiTotals(db: Db, me: Principal, repIds: string[], from: string, to: string, currency: string): Promise<KpiTotals> {
  const rows = repIds.length
    ? (await db.kpi_daily.all({ rep_id: repIds }, { and: [{ column: "day", operator: "gte", value: from }, { column: "day", operator: "lte", value: to }] }))
    : [];
  if (rows.length) {
    const lastDay = rows.map((r) => r.day).sort().pop()!;
    const last = rows.filter((r) => r.day === lastDay && r.crm_completeness_pct != null);
    const revenue_minor = sum(rows, (r) => r.revenue_minor);
    return {
      source: "kpi_daily", days_with_data: new Set(rows.map((r) => r.day)).size,
      visits_done: sum(rows, (r) => r.visits_done), voice_logs: sum(rows, (r) => r.voice_logs), voice_logs_within_1h: sum(rows, (r) => r.voice_logs_within_1h),
      new_customers: sum(rows, (r) => r.new_customers), revenue_minor, revenue: moneyText(revenue_minor, currency),
      customers_saved: sum(rows, (r) => r.customers_saved), discount_requests: sum(rows, (r) => r.discount_requests), discounts_approved: sum(rows, (r) => r.discounts_approved),
      approvals_approved: sum(rows, (r) => r.approvals_approved), approvals_rejected: sum(rows, (r) => r.approvals_rejected),
      ai_actions_applied: sum(rows, (r) => r.ai_actions_applied), ai_actions_undone: sum(rows, (r) => r.ai_actions_undone),
      crm_completeness_pct: last.length ? round1(sum(last, (r) => r.crm_completeness_pct) / last.length) : null,
    };
  }
  // No rollup rows for the period: same definitions from the live tables (metrics.md#target-progress).
  let visits = 0, revenue_minor = 0, newCustomers = 0;
  for (const id of repIds) {
    const a = await repActuals(db, me, id, from, to);
    visits += a.visits; revenue_minor += a.revenue; newCustomers += a.new_customers;
  }
  return {
    source: "live_tables", days_with_data: 0, visits_done: visits, voice_logs: 0, voice_logs_within_1h: 0, new_customers: newCustomers,
    revenue_minor, revenue: moneyText(revenue_minor, currency), customers_saved: 0, discount_requests: 0, discounts_approved: 0,
    approvals_approved: 0, approvals_rejected: 0, ai_actions_applied: 0, ai_actions_undone: 0, crm_completeness_pct: null,
  };
}

interface DealLine { title: string; account: string | null; owner: string | null; stage: string; amount_minor: number; amount: string; date: string | null; days_without_activity?: number }

async function dealFacts(db: Db, me: Principal, repIds: string[], from: string, to: string, currency: string, users: Map<string, Row<"app_user">>) {
  const stages = new Map((await db.deal_stage.all()).map((s) => [s.code, s]));
  const deals = repIds.length ? await db.deal.all({ owner_id: repIds }) : [];
  const range = dateRange(me.org, from, to);
  const inPeriod = (v: unknown) => ms(v) >= ms(range.from) && ms(v) < ms(range.to);
  const accounts = new Map<string, string>();
  const nameOf = async (id: string) => {
    if (!accounts.has(id)) accounts.set(id, (await db.account.get(id))?.name ?? "?");
    return accounts.get(id)!;
  };
  const stuckAlerts = new Set(repIds.length
    ? (await db.alert.all({ alert_type_code: "deal_stuck", status: "open", recipient_id: repIds })).map((a) => a.deal_id).filter(Boolean) as string[]
    : []);
  const line = async (d: Row<"deal">, date: string | null, extra: Partial<DealLine> = {}): Promise<DealLine> => ({
    title: d.title, account: await nameOf(d.account_id), owner: users.get(d.owner_id)?.full_name ?? null,
    stage: stages.get(d.stage_code)?.name ?? d.stage_code, amount_minor: d.amount_minor ?? 0, amount: moneyText(d.amount_minor ?? 0, currency), date, ...extra,
  });
  const open = deals.filter((d) => !stages.get(d.stage_code)?.is_closed);
  const won = deals.filter((d) => stages.get(d.stage_code)?.is_won && d.closed_at && inPeriod(d.closed_at));
  const lost = deals.filter((d) => stages.get(d.stage_code)?.is_closed && !stages.get(d.stage_code)?.is_won && d.closed_at && inPeriod(d.closed_at));
  const quietDays = (d: Row<"deal">) => (d.last_activity_at ? daysBetween(localDate(me.org, d.last_activity_at), to) : null);
  const stuck = open.filter((d) => stuckAlerts.has(d.id) || (quietDays(d) ?? 0) >= STUCK_DAYS || (!!d.expected_close_date && d.expected_close_date <= to));
  const horizon = addDays(to, COMING_DAYS);
  const coming = open.filter((d) => d.expected_close_date && d.expected_close_date > to && d.expected_close_date <= horizon && !stuck.includes(d))
    .sort((a, b) => a.expected_close_date!.localeCompare(b.expected_close_date!) || a.title.localeCompare(b.title));
  const byAmount = (a: Row<"deal">, b: Row<"deal">) => (b.amount_minor ?? 0) - (a.amount_minor ?? 0) || a.title.localeCompare(b.title);
  const weighted = Math.round(sum(open, (d) => (d.amount_minor ?? 0) * (stages.get(d.stage_code)?.probability ?? 0)));
  const openAmount = sum(open, (d) => d.amount_minor);
  const wonAmount = sum(won, (d) => d.amount_minor);
  return {
    won_count: won.length, won_amount_minor: wonAmount, won_amount: moneyText(wonAmount, currency),
    won: await Promise.all(won.sort(byAmount).slice(0, MAX_LIST).map((d) => line(d, d.closed_at ? localDate(me.org, d.closed_at) : null))),
    lost_count: lost.length,
    stuck_count: stuck.length,
    stuck: await Promise.all(stuck.sort(byAmount).slice(0, MAX_LIST).map((d) => line(d, d.expected_close_date ?? null, quietDays(d) != null ? { days_without_activity: quietDays(d)! } : {}))),
    coming_count: coming.length, coming_until: horizon,
    coming: await Promise.all(coming.slice(0, MAX_LIST).map((d) => line(d, d.expected_close_date ?? null))),
    open_count: open.length, open_amount_minor: openAmount, open_amount: moneyText(openAmount, currency),
    weighted_pipeline_minor: weighted, weighted_pipeline: moneyText(weighted, currency),
  };
}

async function alertFacts(db: Db, me: Principal, recipientIds: string[], from: string, to: string) {
  const all = recipientIds.length ? await db.alert.all({ recipient_id: recipientIds }) : [];
  const range = dateRange(me.org, from, to);
  const open = all.filter((a) => a.status === "open");
  const by_type: Record<string, number> = {};
  for (const a of open) by_type[a.alert_type_code] = (by_type[a.alert_type_code] ?? 0) + 1;
  const sev = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  return {
    open_count: open.length, open_by_type: by_type,
    created_in_period: all.filter((a) => ms((a as { created_at?: unknown }).created_at) >= ms(range.from) && ms((a as { created_at?: unknown }).created_at) < ms(range.to)).length,
    top_open: open.sort((a, b) => (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3) || a.alert_type_code.localeCompare(b.alert_type_code)).slice(0, 5)
      .map((a) => ({ type: a.alert_type_code, severity: a.severity, message: a.message ?? "" })),
  };
}

async function beforeAfter(db: Db, me: Principal, repIds: string[], org: Row<"organization">, to: string) {
  if (!org.baseline_start || !org.go_live_date || org.go_live_date <= org.baseline_start) return null;
  const baselineTo = addDays(org.go_live_date, -1);
  const len = daysBetween(org.baseline_start, baselineTo) + 1;
  const afterTo = [addDays(org.go_live_date, len - 1), to].sort()[0]!;
  if (afterTo < org.go_live_date) return null;
  const period = async (from: string, until: string) => {
    const k = await kpiTotals(db, me, repIds, from, until, org.currency);
    const days = daysBetween(from, until) + 1;
    return {
      from, to: until, days, source: k.source, visits_done: k.visits_done, revenue_minor: k.revenue_minor, revenue: k.revenue, new_customers: k.new_customers,
      visits_per_day: round1(k.visits_done / days), crm_completeness_pct: k.crm_completeness_pct,
    };
  };
  const before = await period(org.baseline_start, baselineTo);
  const after = await period(org.go_live_date, afterTo);
  const change = (a: number, b: number) => (a > 0 ? round1((100 * (b - a)) / a) : null);
  return {
    baseline: before, after,
    change_pct: { visits_per_day: change(before.visits_per_day, after.visits_per_day), revenue_per_day: change(before.revenue_minor / before.days, after.revenue_minor / after.days) },
    note: after.days < before.days ? `after period so far has ${after.days} of ${before.days} days` : null,
  };
}

/** Facts for one recipient (`scope`) over local dates from..to. Pure reads; the same input gives the same facts. */
export async function summaryFacts(db: Db, me: Principal, scope: UserPrincipal, kind: Kind, from: string, to: string): Promise<Record<string, unknown>> {
  const org = scope.org;
  const cur = org.currency;
  const reps = await scopeReps(db, scope);
  const users = new Map((await db.app_user.all()).map((u) => [u.id, u]));
  const repIds = reps.map((r) => r.id);
  const kpi = await kpiTotals(db, me, repIds, from, to, cur);
  const per_rep = [];
  for (const r of reps) {
    const k = await kpiTotals(db, me, [r.id], from, to, cur);
    per_rep.push({ name: r.full_name, visits_done: k.visits_done, revenue_minor: k.revenue_minor, revenue: k.revenue, new_customers: k.new_customers });
  }
  const targets = [];
  for (const r of reps) for (const t of await targetProgress(db, me, r.id, from, to, to)) {
    targets.push({ rep: r.full_name, metric: t.metric, period_start: t.period_start, period_end: t.period_end, target_value: t.target_value, actual_value: t.actual_value, pct: t.pct,
      ...(t.metric === "revenue" ? { target: moneyText(t.target_value, cur), actual: moneyText(t.actual_value, cur) } : {}) });
  }
  const facts: Record<string, unknown> = {
    kind, from, to, days: daysBetween(from, to) + 1,
    org: { name: org.name, currency: cur, timezone: org.timezone, language: scope.user.preferred_language || org.default_language },
    recipient: { name: scope.user.full_name, role: scope.role, email: scope.user.email ?? null },
    scope: { rep_count: reps.length, reps: reps.map((r) => r.full_name) },
    kpi, per_rep,
    deals: await dealFacts(db, me, repIds, from, to, cur, users),
    alerts: await alertFacts(db, me, [...new Set([...repIds, scope.id])], from, to),
    targets,
  };
  if (kind === "monthly") {
    facts.monthly = {
      before_after: await beforeAfter(db, me, repIds, org, to),
      crm_completeness_pct: kpi.crm_completeness_pct,
      new_customers: kpi.new_customers,
      customers_saved: kpi.customers_saved,
    };
  }
  return facts;
}

/** The recipient principal, checked against the caller: users see themselves, their team (manager) or the org (admin). */
export async function scopePrincipal(db: Db, me: Principal, scopeUserId: string): Promise<UserPrincipal> {
  const target = await db.app_user.get(scopeUserId);
  if (!target) throw forbidden("scope user is not in your organization", { scope_user_id: scopeUserId });
  if (me.kind === "user" && me.id !== target.id && !isAdmin(me) && !(me.role === "manager" && me.team_user_ids.includes(target.id))) {
    throw forbidden("you can only read summaries for yourself or your team", { scope_user_id: scopeUserId });
  }
  return resolvePrincipal(db.api, { kind: "app_user", appUserId: target.id, orgId: me.org_id });
}

export const impl: Impl<"summary-data", Principal> = async ({ req, db, me }) => {
  if (!isDate(req.from) || !isDate(req.to)) throw invalid("from and to must be dates (YYYY-MM-DD)", { field: "from/to" });
  if (req.from > req.to) throw invalid("from must be on or before to", { from: req.from, to: req.to });
  if (daysBetween(req.from, req.to) > MAX_PERIOD_DAYS) throw invalid(`period is longer than ${MAX_PERIOD_DAYS} days`);
  const scope = await scopePrincipal(db, me, req.scope_user_id);
  return { facts: await summaryFacts(db, me, scope, req.kind, req.from, req.to) };
};

/** Wonderful Function entry (signed-in Merc user; scope checked against the caller). */
export const handle = defineFunction("summary-data", impl);

/**
 * merc-ops tool entry (agents/merc-ops/tools/get_summary_data). Backoffice tools carry no user identity (S9 §4),
 * so the org is the scope user's own org, read from tbl:app_user, and the impl runs with that org's system principal.
 * Only merc-ops calls this; its tasks are created by fn:weekly-summary / fn:monthly-report through secret webhooks.
 */
export async function runForOps(tables: TablesApi, params: unknown, platform: PlatformLike = {}) {
  const uid = (params as { scope_user_id?: unknown } | null)?.scope_user_id;
  const user = typeof uid === "string" ? await createDb(tables).app_user.get(uid) : null;
  if (!user) return { error: { code: "forbidden", message: "scope_user_id is not a Merc user" } };
  return runAsSystem("summary-data", impl, { tables, data: params, orgId: user.org_id, caller: "procedure", platform });
}
