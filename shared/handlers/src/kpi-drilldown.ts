// fn:kpi-drilldown (contracts/functions/kpi-drilldown.json, REQ-DSH-002). Gate dashboard.read, scope dashboard.
// The records behind one KPI of fn:dashboard-kpis, computed by the same engine (kpi-rollup.ts), so the list is
// exactly what the figure counts: at_risk lists the accounts counted in at_risk_customers, revenue the confirmed
// orders summed in revenue_minor, and so on. Items are flat objects (id, name/title, owner, amounts), paged.
import { defineFunction, localDate, type Impl, type Principal, type Row } from "../../core/src/index";
import type { FunctionRequestMap } from "../../core/src/generated/contracts/types";
import { paging } from "./deals-list";
import {
  APPROVED, checkRange, dailyCounts, loadFacts, pct, probabilityOf, resolveReps, savedEvents, snapshot, visitDoneDay,
  type Facts,
} from "./kpi-rollup";
import { epochMs } from "./metrics-rollup";

export type Kpi = FunctionRequestMap["kpi-drilldown"]["kpi"];
type Item = Record<string, unknown>;
const DAY_MS = 86_400_000;

const accountItem = (a: Row<"account">) => ({
  id: a.id, name: a.name, account_type: a.account_type, owner_rep_id: a.owner_rep_id ?? null, territory_id: a.territory_id ?? null, postal_code: a.postal_code ?? null,
});

function localDay(f: Facts, v: unknown): string | null {
  const ms = typeof v === "string" && !/^\d+$/.test(v) ? Date.parse(v) : epochMs(v);
  return ms === null || Number.isNaN(ms) || ms <= 0 ? null : localDate(f.org, ms);
}
const inRange = (d: string | null, from: string, to: string) => !!d && d >= from && d <= to;

/** Threshold in days of the org's deal_stuck rule (alert_rule), default 14. */
async function stuckDays(db: Parameters<Impl<"kpi-drilldown">>[0]["db"]): Promise<number> {
  const r = await db.alert_rule.findOne({ alert_type_code: "deal_stuck", enabled: true });
  return typeof r?.threshold_value === "number" ? r.threshold_value : 14;
}

/** Every record behind `kpi` for the facts' reps over from..to (unpaged, in display order). */
export async function drillItems(kpi: Kpi, f: Facts, from: string, to: string, opts: { stuckDays?: number } = {}): Promise<Item[]> {
  const accName = new Map(f.accounts.map((a) => [a.id, a.name]));
  const reps = new Set(f.repIds);
  switch (kpi) {
    case "at_risk":
      return snapshot(f).atRisk.map((r) => ({
        ...accountItem(r.account), risk_score: r.metrics.risk_score ?? 0, risk_reasons: r.metrics.risk_reasons ?? null,
        reason: r.metrics.risk_reasons ?? null, days_since_last_order: r.metrics.days_since_last_order ?? null,
        last_order_date: r.metrics.last_order_date ?? null, at_risk_value_minor: r.value_minor,
      }));
    case "lost":
      return snapshot(f).lost.map(accountItem);
    case "new_customers":
      return f.accounts.filter((a) => inRange(a.customer_since ?? null, from, to))
        .sort((a, b) => String(b.customer_since).localeCompare(String(a.customer_since)) || a.name.localeCompare(b.name))
        .map((a) => ({ ...accountItem(a), customer_since: a.customer_since }));
    case "incomplete_accounts":
      return snapshot(f).completeness.incomplete.map((x) => ({ ...accountItem(x.account), missing: x.missing, reason: x.missing.join(", ") }));
    case "pipeline":
    case "stuck_deals": {
      let deals = snapshot(f).openDeals;
      if (kpi === "stuck_deals") {
        const limit = f.now - (opts.stuckDays ?? 14) * DAY_MS;
        deals = deals.filter((d) => { const t = epochMs(d.last_activity_at) ?? epochMs(d.created_at); return t !== null && t > 0 && t < limit; });
      }
      return deals
        .sort((a, b) => (b.amount_minor ?? 0) - (a.amount_minor ?? 0) || a.title.localeCompare(b.title))
        .map((d) => ({
          id: d.id, title: d.title, account_id: d.account_id, account_name: accName.get(d.account_id) ?? null, stage_code: d.stage_code,
          amount_minor: d.amount_minor ?? null, weighted_minor: Math.round((d.amount_minor ?? 0) * probabilityOf(f.stages.get(d.stage_code))),
          owner_id: d.owner_id, expected_close_date: d.expected_close_date ?? null, last_activity_at: d.last_activity_at ?? null,
        }));
    }
    case "revenue":
      return f.orders.filter((o) => inRange(o.order_date, from, to))
        .sort((a, b) => b.order_date.localeCompare(a.order_date) || a.id.localeCompare(b.id))
        .map((o) => ({ id: o.id, account_id: o.account_id, account_name: accName.get(o.account_id) ?? null, order_date: o.order_date, rep_id: o.rep_id, amount_minor: f.orderTotal.get(o.id) ?? 0, source: o.source, status: o.status }));
    case "visits":
      return f.visits.filter((v) => inRange(visitDoneDay(f, v), from, to))
        .sort((a, b) => String(visitDoneDay(f, b)).localeCompare(String(visitDoneDay(f, a))) || a.id.localeCompare(b.id))
        .map((v) => ({ id: v.id, account_id: v.account_id, account_name: accName.get(v.account_id) ?? null, rep_id: v.rep_id, day: visitDoneDay(f, v), planned_date: v.planned_date, status: v.status, purpose: v.purpose ?? null, outcome: v.outcome ?? null }));
    case "customers_saved":
      return savedEvents(f).filter((s) => reps.has(s.rep_id) && inRange(s.order_date, from, to))
        .sort((a, b) => b.order_date.localeCompare(a.order_date))
        .map((s) => ({ id: s.account_id, name: accName.get(s.account_id) ?? null, account_id: s.account_id, alert_id: s.alert_id, alert_day: s.alert_day, order_id: s.order_id, order_date: s.order_date, rep_id: s.rep_id, amount_minor: f.orderTotal.get(s.order_id) ?? 0 }));
    case "low_logging": {
      // Per rep logging discipline over the period, worst first: done visits vs voice logs and the within-1h share.
      const daily = dailyCounts(f, from, to);
      return f.repIds.map((id) => {
        let visits = 0, logs = 0, fast = 0;
        for (const c of (daily.get(id) ?? new Map()).values()) { visits += c.visits_done; logs += c.voice_logs; fast += c.voice_logs_within_1h; }
        const unlogged = f.visits.filter((v) => v.rep_id === id && inRange(visitDoneDay(f, v), from, to) && !f.voiceLogs.some((l) => l.visit_id === v.id && l.status !== "failed")).length;
        return { id, rep_id: id, visits_done: visits, voice_logs: logs, voice_logs_within_1h: fast, voice_logs_within_1h_pct: pct(fast, logs), visits_without_log: unlogged, status: unlogged > 0 ? "missing_logs" : "ok" };
      }).sort((a, b) => b.visits_without_log - a.visits_without_log || a.voice_logs_within_1h_pct - b.voice_logs_within_1h_pct || a.id.localeCompare(b.id));
    }
    case "ai_actions":
      return f.aiActions.filter((a) => inRange(localDay(f, a.applied_at), from, to) || (a.status === "undone" && inRange(localDay(f, a.undone_at), from, to)))
        .sort((a, b) => String(b.applied_at ?? "").localeCompare(String(a.applied_at ?? "")))
        .map((a) => ({ id: a.id, agent: a.agent, action_type_code: a.action_type_code, status: a.status, reason: a.reason ?? null, rep_id: a.on_behalf_of, target_table: a.target_table ?? null, target_id: a.target_id ?? null, applied_at: a.applied_at ?? null, undone_at: a.undone_at ?? null }));
    case "approvals":
      return f.approvals.filter((a) => (APPROVED as readonly string[]).concat("rejected").includes(a.status) && inRange(localDay(f, a.decided_at), from, to))
        .sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)))
        .map((a) => ({ id: a.id, kind: a.kind, status: a.status, rep_id: a.requested_by, approver_id: a.approver_id, decided_at: a.decided_at ?? null, decided_via: a.decided_via ?? null, reason: a.decision_note ?? null }));
    case "discounts": {
      const ap = new Map(f.approvals.map((a) => [a.id, a]));
      return f.discounts.filter((d) => { const a = ap.get(d.approval_id); return !!a && inRange(localDay(f, d.created_at) ?? localDay(f, a.created_at), from, to); })
        .map((d) => { const a = ap.get(d.approval_id)!; return { id: d.id, approval_id: d.approval_id, account_id: d.account_id, account_name: accName.get(d.account_id) ?? null, rep_id: a.requested_by, status: a.status, requested_pct: d.requested_pct, policy_limit_pct: d.policy_limit_pct, approved_pct: d.approved_pct ?? null, reason: d.justification ?? null }; });
    }
  }
}

export function makeImpl(deps: { now?: () => number } = {}): Impl<"kpi-drilldown", Principal> {
  return async ({ req, db, me }) => {
    checkRange(req.from, req.to);
    const { page, limit, offset } = paging(req);
    const { repIds } = await resolveReps(db, me, { scope: "team", rep_id: req.rep_id, territory_id: req.territory_id });
    const f = await loadFacts(db, me, repIds, (deps.now ?? Date.now)());
    const all = await drillItems(req.kpi, f, req.from, req.to, req.kpi === "stuck_deals" ? { stuckDays: await stuckDays(db) } : {});
    return { items: all.slice(offset, offset + limit), page: { page, limit, total: all.length } };
  };
}
export const impl = makeImpl();

/** Wonderful Function entry (functions/kpi-drilldown/index.ts calls this). */
export const handle = defineFunction("kpi-drilldown", impl);

