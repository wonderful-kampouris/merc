// fn:kpi-rollup (contracts/functions/kpi-rollup.json, REQ-DSH-001/004). Cron "5 0 * * *".
// Writes yesterday's tbl:kpi_daily row per rep (upsert on rep_id + day), exactly as contracts/metrics.md says.
// This file is also the KPI engine the dashboard functions share (Rule B, REQ-CORE-004):
//   loadFacts()     one read of the rows behind every KPI, for a set of reps
//   dailyCounts()   per rep per local day event counts (visits, voice logs, revenue, approvals, ...)
//   snapshot()      point-in-time figures (open pipeline, crm completeness, at risk, lost)
//   resolveReps()   the dashboard scope (REQ-CORE-009): own for reps, team for managers, all for admin
// Every number comes from a query (REQ-CORE-003); dates are in the org timezone (REQ-CORE-007).
import {
  addDays, datesBetween, defineCron, forbidden, invalid, isAdmin, isDate, localDate, today, visibleTerritoryIds, dashboardRepIds,
  type Db, type FunctionContext, type Impl, type Principal, type Row,
} from "../../core/src/index";
import { epochMs, inChunks } from "./metrics-rollup";
import { lineTotalMinor } from "./my-performance";
import { AT_RISK_MIN } from "./briefing-generate";

const DAY_MS = 86_400_000;
/** metrics.md#voice-log-within-1h */
export const WITHIN_1H_MS = 60 * 60_000;
/** metrics.md#customers-saved: an order within 30 days of the going_quiet alert. */
export const SAVED_WINDOW_DAYS = 30;
/** at_risk_value_minor: confirmed revenue of the at-risk accounts over this many days before today (see report). */
export const AT_RISK_VALUE_DAYS = 90;
export const MAX_RANGE_DAYS = 400;
const CAP = 50_000;

/** Event-count columns of tbl:kpi_daily (summed over days). */
export const COUNT_FIELDS = [
  "visits_done", "voice_logs", "voice_logs_within_1h", "new_customers", "ai_actions_applied", "ai_actions_undone",
  "approvals_approved", "approvals_rejected", "revenue_minor", "customers_saved", "discount_requests", "discounts_approved",
] as const;
export type CountField = (typeof COUNT_FIELDS)[number];
export type DayCounts = Record<CountField, number>;
export const zeroCounts = (): DayCounts => Object.fromEntries(COUNT_FIELDS.map((k) => [k, 0])) as DayCounts;
export function addCounts(a: DayCounts, b: Partial<Record<CountField, number | null | undefined>>): DayCounts {
  for (const k of COUNT_FIELDS) a[k] += Number(b[k] ?? 0) || 0;
  return a;
}

/** Approval statuses that count as an approval decision (a counter-offer approves a lower discount; sent follows approval). */
export const APPROVED = ["approved", "countered", "sent"] as const;

// ---- scope -----------------------------------------------------------------------------------

export interface RepScope { reps: Row<"app_user">[]; repIds: string[] }

/**
 * Users whose numbers a dashboard call covers (scope `dashboard`, REQ-CORE-009).
 *   me   -> the caller; team -> rep: self, manager: reports, admin: every rep; org -> admin only.
 *   rep_id narrows to one user (must be in scope); territory_id keeps users working in that territory.
 * Team and org cover users with role rep (managers' own rows are not a rep's numbers).
 */
export async function resolveReps(db: Db, me: Principal, q: { scope?: "me" | "team" | "org" | null; rep_id?: string | null; territory_id?: string | null }): Promise<RepScope> {
  const scope = q.scope ?? "team";
  if (scope === "org" && !isAdmin(me)) throw forbidden("scope org is for admins");
  if (scope === "me" && me.kind !== "user") throw forbidden("scope me needs a signed-in Merc user");
  const users = await db.app_user.all();
  let ids: string[];
  if (q.rep_id) ids = dashboardRepIds(me, q.rep_id)!;
  else if (scope === "me") ids = [me.id];
  else {
    const visible = dashboardRepIds(me);
    ids = users.filter((u) => (visible === null || visible.includes(u.id)) && (u.role_code === "rep" || (visible?.length === 1 && u.id === me.id))).map((u) => u.id);
  }
  if (q.territory_id) {
    const terr = visibleTerritoryIds(me);
    if (terr !== null && !terr.includes(q.territory_id)) throw forbidden("territory is outside your scope");
    const t = await db.territory.get(q.territory_id);
    if (!t) throw invalid("unknown territory_id", { territory_id: q.territory_id });
    const members = new Set((await db.territory_rep.all({ territory_id: q.territory_id })).map((r) => r.user_id));
    ids = ids.filter((id) => members.has(id));
  }
  const byId = new Map(users.map((u) => [u.id, u]));
  const reps = ids.map((id) => byId.get(id)).filter((u): u is Row<"app_user"> => !!u).sort((a, b) => a.full_name.localeCompare(b.full_name));
  return { reps, repIds: reps.map((u) => u.id) };
}

export function checkRange(from: string, to: string): void {
  if (!isDate(from) || !isDate(to)) throw invalid("from and to must be dates (YYYY-MM-DD)", { from, to });
  if (from > to) throw invalid("from must be on or before to", { from, to });
  if (datesBetween(from, to).length > MAX_RANGE_DAYS) throw invalid(`range is limited to ${MAX_RANGE_DAYS} days`, { from, to });
}

// ---- facts -----------------------------------------------------------------------------------

/** Every row behind the KPIs of a set of reps (one read per table, chunked `in` filters). */
export interface Facts {
  org: Row<"organization">;
  now: number;
  today: string;
  repIds: string[];
  /** Accounts owned by the reps (any type). */
  accounts: Row<"account">[];
  metrics: Map<string, Row<"account_metrics">>;
  decisionMakerAccounts: Set<string>;
  /** Deals of the reps' accounts or owned by the reps. */
  deals: Row<"deal">[];
  stages: Map<string, Row<"deal_stage">>;
  visits: Row<"visit">[];
  voiceLogs: Row<"voice_log">[];
  orders: Row<"sales_order">[];
  orderTotal: Map<string, number>;
  aiActions: Row<"ai_action">[];
  approvals: Row<"approval">[];
  discounts: Row<"discount_request">[];
  goingQuiet: Row<"alert">[];
}

const byKey = <T, K>(rows: T[], key: (r: T) => K) => new Map(rows.map((r) => [key(r), r]));

export async function loadFacts(db: Db, me: Principal, repIds: string[], now: number): Promise<Facts> {
  const accounts = await inChunks(repIds, (c) => db.account.all({ owner_rep_id: c }, { cap: CAP }));
  const accIds = accounts.map((a) => a.id);
  const metricRows = await inChunks(accIds, (c) => db.account_metrics.all({ account_id: c }, { cap: CAP }));
  const metrics = new Map<string, Row<"account_metrics">>();
  for (const m of metricRows) { const cur = metrics.get(m.account_id); if (!cur || String(m.computed_at) > String(cur.computed_at)) metrics.set(m.account_id, m); }
  const contacts = await inChunks(accIds, (c) => db.contact.all({ account_id: c, is_decision_maker: true }, { cap: CAP }));
  const dealsByAcc = await inChunks(accIds, (c) => db.deal.all({ account_id: c }, { cap: CAP }));
  const dealsByOwner = await inChunks(repIds, (c) => db.deal.all({ owner_id: c }, { cap: CAP }));
  const deals = [...byKey([...dealsByAcc, ...dealsByOwner], (d) => d.id).values()];
  const stages = byKey(await db.deal_stage.all(), (s) => s.code);
  const visits = await inChunks(repIds, (c) => db.visit.all({ rep_id: c }, { cap: CAP }));
  const voiceLogs = await inChunks(repIds, (c) => db.voice_log.all({ rep_id: c }, { cap: CAP }));
  const orders = await inChunks(repIds, (c) => db.sales_order.all({ rep_id: c, status: "confirmed" }, { cap: CAP }));
  const lines = await inChunks(orders.map((o) => o.id), (c) => db.order_line.all({ order_id: c }, { cap: CAP }));
  const orderTotal = new Map<string, number>();
  for (const l of lines) orderTotal.set(l.order_id, (orderTotal.get(l.order_id) ?? 0) + lineTotalMinor(l));
  const aiActions = await inChunks(repIds, (c) => db.ai_action.all({ on_behalf_of: c }, { cap: CAP }));
  const approvals = await inChunks(repIds, (c) => db.approval.all({ requested_by: c }, { cap: CAP }));
  const discounts = await inChunks(approvals.filter((a) => a.kind === "discount").map((a) => a.id), (c) => db.discount_request.all({ approval_id: c }, { cap: CAP }));
  // going_quiet alerts of any account a rep sold to (the saved order may come from a rep who does not own it).
  const orderAccIds = [...new Set([...accIds, ...orders.map((o) => o.account_id)])];
  const goingQuiet = await inChunks(orderAccIds, (c) => db.alert.all({ account_id: c, alert_type_code: "going_quiet" }, { cap: CAP }));
  return {
    org: me.org, now, today: today(me.org, now), repIds, accounts, metrics,
    decisionMakerAccounts: new Set(contacts.map((c) => c.account_id)),
    deals, stages, visits, voiceLogs, orders, orderTotal, aiActions, approvals, discounts, goingQuiet,
  };
}

// ---- per-day event counts ----------------------------------------------------------------------

const localOf = (f: Facts, instant: unknown): string | null => {
  if (instant === null || instant === undefined || instant === "") return null;
  const ms = typeof instant === "string" && !/^\d+$/.test(instant) ? Date.parse(instant) : epochMs(instant);
  return ms === null || Number.isNaN(ms) || ms <= 0 ? null : localDate(f.org, ms);
};
/** Local day a visit was done: completed_at, else its planned date. */
export const visitDoneDay = (f: Facts, v: Row<"visit">): string | null => (v.status === "done" ? localOf(f, v.completed_at) ?? v.planned_date : null);
/** Instant a voice log was created (metrics.md uses created_at; recorded_at when the system column is missing). */
const voiceLogMs = (v: Row<"voice_log">): number | null => {
  const c = epochMs(v.created_at);
  return c && c > 0 ? c : epochMs(v.recorded_at);
};
export const voiceLogDay = (f: Facts, v: Row<"voice_log">): string | null => localOf(f, v.recorded_at) ?? localOf(f, voiceLogMs(v));

/** metrics.md#voice-log-within-1h for one voice log (needs its visit). */
export function within1h(v: Row<"voice_log">, visit: Row<"visit"> | undefined): boolean {
  if (!visit || visit.status !== "done") return false;
  const done = epochMs(visit.completed_at), at = voiceLogMs(v);
  if (done === null || at === null) return !visit.completed_at; // marked done by the debrief itself
  return at - done <= WITHIN_1H_MS;
}

/** One saved customer (metrics.md#customers-saved). */
export interface SavedEvent { alert_id: string; account_id: string; order_id: string; order_date: string; rep_id: string; alert_day: string }
export function savedEvents(f: Facts): SavedEvent[] {
  const ordersByAcc = new Map<string, Row<"sales_order">[]>();
  for (const o of [...f.orders].sort((a, b) => a.order_date.localeCompare(b.order_date) || a.id.localeCompare(b.id))) {
    (ordersByAcc.get(o.account_id) ?? ordersByAcc.set(o.account_id, []).get(o.account_id)!).push(o);
  }
  const seen = new Set<string>();
  const out: SavedEvent[] = [];
  for (const a of f.goingQuiet) {
    const opened = localOf(f, a.created_at);
    if (!a.account_id || !opened) continue;
    const order = (ordersByAcc.get(a.account_id) ?? []).find((o) => o.order_date >= opened && o.order_date <= addDays(opened, SAVED_WINDOW_DAYS));
    if (!order) continue;
    const key = `${a.account_id}|${order.id}`; // counted once per saving order
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ alert_id: a.id, account_id: a.account_id, order_id: order.id, order_date: order.order_date, rep_id: order.rep_id, alert_day: opened });
  }
  return out;
}

export type Daily = Map<string, Map<string, DayCounts>>;
/** Per rep per local day counts over from..to (inclusive) from the live tables. */
export function dailyCounts(f: Facts, from: string, to: string): Daily {
  const out: Daily = new Map(f.repIds.map((id) => [id, new Map<string, DayCounts>()]));
  const reps = new Set(f.repIds);
  const bump = (rep: string | null | undefined, day: string | null, k: CountField, n = 1) => {
    if (!rep || !reps.has(rep) || !day || day < from || day > to) return;
    const m = out.get(rep)!;
    (m.get(day) ?? m.set(day, zeroCounts()).get(day)!)[k] += n;
  };
  const visitById = byKey(f.visits, (v) => v.id);
  for (const v of f.visits) bump(v.rep_id, visitDoneDay(f, v), "visits_done");
  for (const l of f.voiceLogs) {
    if (l.status === "failed") continue;
    const day = voiceLogDay(f, l);
    bump(l.rep_id, day, "voice_logs");
    if (l.visit_id && within1h(l, visitById.get(l.visit_id))) bump(l.rep_id, day, "voice_logs_within_1h");
  }
  for (const a of f.accounts) if (a.customer_since) bump(a.owner_rep_id, a.customer_since, "new_customers");
  for (const a of f.aiActions) {
    if (a.applied_at) bump(a.on_behalf_of, localOf(f, a.applied_at), "ai_actions_applied");
    if (a.status === "undone") bump(a.on_behalf_of, localOf(f, a.undone_at), "ai_actions_undone");
  }
  const approvalById = byKey(f.approvals, (a) => a.id);
  for (const a of f.approvals) {
    const day = localOf(f, a.decided_at);
    if ((APPROVED as readonly string[]).includes(a.status)) bump(a.requested_by, day, "approvals_approved");
    if (a.status === "rejected") bump(a.requested_by, day, "approvals_rejected");
  }
  for (const d of f.discounts) {
    const ap = approvalById.get(d.approval_id);
    if (!ap) continue;
    bump(ap.requested_by, localOf(f, d.created_at) ?? localOf(f, ap.created_at), "discount_requests");
    if ((APPROVED as readonly string[]).includes(ap.status) && ap.status !== "sent") bump(ap.requested_by, localOf(f, ap.decided_at), "discounts_approved");
  }
  for (const o of f.orders) bump(o.rep_id, o.order_date, "revenue_minor", f.orderTotal.get(o.id) ?? 0);
  for (const s of savedEvents(f)) bump(s.rep_id, s.order_date, "customers_saved");
  return out;
}

// ---- point-in-time figures ---------------------------------------------------------------------

/** Deal stage probability as a 0-1 factor (seed stores 0.1; a 0-100 value is accepted too). */
export const probabilityOf = (s: Row<"deal_stage"> | undefined): number => (!s ? 0 : s.probability > 1 ? s.probability / 100 : s.probability);
export const isOpenDeal = (f: Facts, d: Row<"deal">): boolean => { const s = f.stages.get(d.stage_code); return !!s && !s.is_closed; };

/** metrics.md#crm-completeness: the missing parts of one account (empty = complete). */
export function missingParts(f: Facts, a: Row<"account">, openDealsByAcc: Map<string, Row<"deal">[]>): string[] {
  const miss: string[] = [];
  if (!a.category_id) miss.push("category");
  if (!a.phone && !a.email) miss.push("phone_or_email");
  if (!a.postal_code) miss.push("postal_code");
  if (!a.owner_rep_id) miss.push("owner");
  if (!f.decisionMakerAccounts.has(a.id)) miss.push("decision_maker");
  if ((openDealsByAcc.get(a.id) ?? []).some((d) => d.amount_minor == null || !d.expected_close_date)) miss.push("deal_amount_or_close_date");
  return miss;
}
export const isActiveAccount = (a: Row<"account">) => a.account_type === "customer" || a.account_type === "prospect";

export interface RiskRow { account: Row<"account">; metrics: Row<"account_metrics">; value_minor: number }
export interface Snapshot {
  pipeline_by_stage: Array<{ stage_code: string; amount_minor: number; count: number }>;
  pipeline_amount_minor: number;
  weighted_pipeline_minor: number;
  openDeals: Row<"deal">[];
  completeness: { active: number; complete: number; pct: number; incomplete: Array<{ account: Row<"account">; missing: string[] }> };
  atRisk: RiskRow[];
  at_risk_value_minor: number;
  lost: Row<"account">[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
export const pct = (num: number, den: number): number => (den > 0 ? round1((100 * num) / den) : 0);

/** Point-in-time figures of the given reps (subset of the facts' reps). */
export function snapshot(f: Facts, repIds: readonly string[] = f.repIds): Snapshot {
  const reps = new Set(repIds);
  const accounts = f.accounts.filter((a) => a.owner_rep_id && reps.has(a.owner_rep_id));
  const openDeals = f.deals.filter((d) => isOpenDeal(f, d) && reps.has(d.owner_id));
  const stageRows = [...f.stages.values()].filter((s) => !s.is_closed).sort((a, b) => a.sort_order - b.sort_order);
  const pipeline_by_stage = stageRows.map((s) => {
    const ds = openDeals.filter((d) => d.stage_code === s.code);
    return { stage_code: s.code, amount_minor: ds.reduce((x, d) => x + (d.amount_minor ?? 0), 0), count: ds.length };
  });
  const pipeline_amount_minor = openDeals.reduce((x, d) => x + (d.amount_minor ?? 0), 0);
  const weighted_pipeline_minor = Math.round(openDeals.reduce((x, d) => x + (d.amount_minor ?? 0) * probabilityOf(f.stages.get(d.stage_code)), 0));

  const openByAcc = new Map<string, Row<"deal">[]>();
  for (const d of f.deals) if (isOpenDeal(f, d)) (openByAcc.get(d.account_id) ?? openByAcc.set(d.account_id, []).get(d.account_id)!).push(d);
  const active = accounts.filter(isActiveAccount);
  const incomplete = active.map((a) => ({ account: a, missing: missingParts(f, a, openByAcc) })).filter((x) => x.missing.length > 0);

  const since = addDays(f.today, -AT_RISK_VALUE_DAYS);
  const revenueByAcc = new Map<string, number>();
  for (const o of f.orders) if (o.order_date > since && o.order_date <= f.today) revenueByAcc.set(o.account_id, (revenueByAcc.get(o.account_id) ?? 0) + (f.orderTotal.get(o.id) ?? 0));
  const atRisk = accounts
    .filter((a) => a.account_type === "customer")
    .map((a) => ({ account: a, metrics: f.metrics.get(a.id)!, value_minor: revenueByAcc.get(a.id) ?? 0 }))
    .filter((r) => r.metrics && (r.metrics.risk_score ?? 0) >= AT_RISK_MIN)
    .sort((a, b) => (b.metrics.risk_score ?? 0) - (a.metrics.risk_score ?? 0) || a.account.name.localeCompare(b.account.name));
  return {
    pipeline_by_stage, pipeline_amount_minor, weighted_pipeline_minor, openDeals,
    completeness: { active: active.length, complete: active.length - incomplete.length, pct: pct(active.length - incomplete.length, active.length), incomplete },
    atRisk, at_risk_value_minor: atRisk.reduce((x, r) => x + r.value_minor, 0),
    lost: accounts.filter((a) => a.account_type === "lost").sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Mon-Fri days in from..to (at least 1), the denominator of the per-rep-day rates. */
export const workingDays = (from: string, to: string): number =>
  Math.max(1, datesBetween(from, to).filter((d) => { const wd = new Date(`${d}T12:00:00Z`).getUTCDay(); return wd !== 0 && wd !== 6; }).length);

// ---- rollup ------------------------------------------------------------------------------------

/** Active users with role rep in the org (the rows the rollup writes). */
export async function orgReps(db: Db): Promise<Row<"app_user">[]> {
  return (await db.app_user.all({ role_code: "rep", status: "active" })).sort((a, b) => a.id.localeCompare(b.id));
}

/** The kpi_daily row of one rep for one day (counts + that day's snapshot). */
export function kpiRow(f: Facts, daily: Daily, repId: string, day: string): Omit<Row<"kpi_daily">, "id"> {
  const c = daily.get(repId)?.get(day) ?? zeroCounts();
  const s = snapshot(f, [repId]);
  return {
    rep_id: repId, day, ...c,
    pipeline_amount_minor: s.pipeline_amount_minor,
    weighted_pipeline_minor: s.weighted_pipeline_minor,
    crm_completeness_pct: s.completeness.pct,
  };
}

export interface RollupDeps { now?: () => number }
export function makeImpl(deps: RollupDeps = {}): Impl<"kpi-rollup", Principal> {
  return async ({ req, db, me }) => {
    const now = (deps.now ?? Date.now)();
    const day = addDays(today(me.org, now), -1); // "yesterday per rep" (contract notes)
    const reps = await orgReps(db);
    const repIds = reps.map((r) => r.id);
    const f = await loadFacts(db, me, repIds, now);
    const daily = dailyCounts(f, day, day);
    const existing = new Map((await inChunks(repIds, (c) => db.kpi_daily.all({ rep_id: c, day }))).map((r) => [r.rep_id, r]));
    const dry = req.dry_run === true;
    let created = 0, updated = 0;
    const rows: Array<Omit<Row<"kpi_daily">, "id">> = [];
    for (const id of repIds) {
      const row = kpiRow(f, daily, id, day);
      rows.push(row);
      const cur = existing.get(id);
      if (!cur) { if (!dry) await db.kpi_daily.insert(row); created++; }
      else { if (!dry) await db.kpi_daily.update(cur.id, row); updated++; }
    }
    return { processed: repIds.length, created, details: { day, updated, dry_run: dry, rows: dry ? rows : null } };
  };
}
export const impl = makeImpl();

/** Cron params arrive in context.data (or params); only the contract key `dry_run` is kept. */
export function cronData(context: { data?: unknown; params?: unknown }): { dry_run?: boolean | null } {
  const raw = (context.data ?? context.params ?? {}) as Record<string, unknown>;
  return raw && typeof raw === "object" && "dry_run" in raw ? { dry_run: raw.dry_run as boolean | null } : {};
}

export const handle = (context: FunctionContext & { params?: unknown }) => defineCron("kpi-rollup", impl)({ ...context, data: cronData(context) });

export { DAY_MS };
