// fn:alerts-engine (contracts/functions/alerts-engine.json, REQ-ALR-001/002/004). Cron "0 * * * *".
// Evaluates every enabled tbl:alert_rule of the org for the 8 alert types, dedupes on alert.dedupe_key
// (a key that already exists is never inserted again) and pushes alert.created through shared/live.
//   going_quiet        customer: days_since_last_order >= threshold x avg (account_metrics)   -> owner rep
//   deal_stuck         open deal: last_activity_at older than threshold days                   -> deal owner
//   close_date_passed  open deal: expected_close_date more than threshold days in the past     -> deal owner
//   promise_due        open customer-promise task due within threshold days (or overdue)       -> task owner
//   competition_wave   >= threshold signals of one competitor in one territory, last window_days -> territory manager
//   visit_overdue      customer: today - last done visit > threshold x visit frequency          -> owner rep
//   rep_not_logging    rep with >=1 visit and 0 voice logs in the last threshold working days   -> rep's manager
//   approval_overdue   pending approval past due_at (+ threshold minutes)                       -> requester's manager
// Manager alerts (the last three) go to the manager (REQ-ALR-004). Messages are deterministic, no LLM.
import { addDays, conflict, dateRange, daysBetween, defineCron, localDate, startOfWeek, today, weekday, type Db, type FunctionContext, type Impl, type Principal, type Row } from "../../core/src/index";
import { pushToRepAndTeams, type PushPlatform, type PushResult } from "../../live/src/index";
import { cronData, inChunks } from "./metrics-rollup";
import { toCard } from "./alerts-list";

export const ALERT_TYPES = ["going_quiet", "deal_stuck", "close_date_passed", "promise_due", "competition_wave", "visit_overdue", "rep_not_logging", "approval_overdue"] as const;
export type AlertTypeCode = (typeof ALERT_TYPES)[number];
const DAY_MS = 86_400_000;

export interface Candidate {
  alert_type_code: AlertTypeCode;
  recipient_id: string;
  dedupe_key: string;
  message: string;
  account_id?: string | null;
  deal_id?: string | null;
  task_id?: string | null;
  territory_id?: string | null;
  competitor_id?: string | null;
}
type Rule = Row<"alert_rule">;
interface Ctx { db: Db; me: Principal; now: number; day: string; users: Map<string, Row<"app_user">>; accounts: Map<string, Row<"account">> }
type Evaluator = (c: Ctx, rule: Rule) => Promise<Candidate[]>;

const num = (v: number | null | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const fmt = (n: number) => String(Math.round(n * 10) / 10);
const active = (c: Ctx, id: string | null | undefined) => (id && c.users.get(id)?.status === "active" ? id : null);
const customers = (c: Ctx) => [...c.accounts.values()].filter((a) => a.account_type === "customer");
const openDeals = async (c: Ctx) => {
  const closed = new Set((await c.db.deal_stage.all()).filter((s) => s.is_closed).map((s) => s.code));
  return (await inChunks([...c.accounts.keys()], (ids) => c.db.deal.all({ account_id: ids }))).filter((d) => !closed.has(d.stage_code) && !d.closed_at);
};
/** The last `n` Mon-Fri dates strictly before `day`, oldest first. */
export function previousWorkingDays(day: string, n: number): string[] {
  const out: string[] = [];
  for (let d = addDays(day, -1); out.length < n; d = addDays(d, -1)) if (weekday(d) <= 5) out.unshift(d);
  return out;
}

export const EVALUATORS: Record<AlertTypeCode, Evaluator> = {
  async going_quiet(c, rule) {
    const k = num(rule.threshold_value, 1.5);
    const list = customers(c);
    const metrics = await inChunks(list.map((a) => a.id), (ids) => c.db.account_metrics.all({ account_id: ids }));
    const out: Candidate[] = [];
    for (const m of metrics) {
      const a = c.accounts.get(m.account_id)!, to = active(c, a.owner_rep_id);
      const avg = m.avg_order_interval_days, days = m.days_since_last_order;
      if (!to || avg == null || days == null || !m.last_order_date || !(days >= k * avg)) continue;
      out.push({ alert_type_code: "going_quiet", recipient_id: to, account_id: a.id, territory_id: a.territory_id ?? null,
        dedupe_key: `going_quiet:${a.id}:${m.last_order_date}`, message: `${a.name} hasn't ordered in ${days} days (usually every ${fmt(avg)})` });
    }
    return out;
  },
  async deal_stuck(c, rule) {
    const k = num(rule.threshold_value, 14);
    return (await openDeals(c)).flatMap((d) => {
      const to = active(c, d.owner_id);
      if (!to || !d.last_activity_at) return [];
      const last = localDate(c.me.org, d.last_activity_at), days = daysBetween(last, c.day);
      if (!(days > k)) return [];
      const a = c.accounts.get(d.account_id);
      return [{ alert_type_code: "deal_stuck" as const, recipient_id: to, account_id: d.account_id, deal_id: d.id,
        dedupe_key: `deal_stuck:${d.id}:${last}`, message: `Deal "${d.title}"${a ? ` at ${a.name}` : ""} has had no activity for ${days} days` }];
    });
  },
  async close_date_passed(c, rule) {
    const k = num(rule.threshold_value, 0);
    return (await openDeals(c)).flatMap((d) => {
      const to = active(c, d.owner_id);
      if (!to || !d.expected_close_date || !(daysBetween(d.expected_close_date, c.day) > k)) return [];
      const a = c.accounts.get(d.account_id);
      return [{ alert_type_code: "close_date_passed" as const, recipient_id: to, account_id: d.account_id, deal_id: d.id,
        dedupe_key: `close_date_passed:${d.id}:${d.expected_close_date}`, message: `Deal "${d.title}"${a ? ` at ${a.name}` : ""} was expected to close on ${d.expected_close_date}` }];
    });
  },
  async promise_due(c, rule) {
    const k = num(rule.threshold_value, 1);
    const users = [...c.users.keys()];
    const tasks = await inChunks(users, (ids) => c.db.task.all({ owner_id: ids, status: "open", is_customer_promise: true }));
    return tasks.flatMap((t) => {
      const to = active(c, t.owner_id);
      if (!to || !t.due_at) return [];
      const due = localDate(c.me.org, t.due_at);
      if (!(daysBetween(c.day, due) <= k)) return [];
      const a = t.account_id ? c.accounts.get(t.account_id) : undefined;
      const when = due < c.day ? `was due ${due}` : due === c.day ? "is due today" : `is due ${due}`;
      return [{ alert_type_code: "promise_due" as const, recipient_id: to, account_id: t.account_id ?? null, deal_id: t.deal_id ?? null, task_id: t.id,
        dedupe_key: `promise_due:${t.id}:${due}`, message: `Promise${a ? ` to ${a.name}` : ""} ${when}: ${t.title}` }];
    });
  },
  async competition_wave(c, rule) {
    const k = num(rule.threshold_value, 3), win = num(rule.window_days, 7);
    const since = new Date(c.now - win * DAY_MS).toISOString(), until = new Date(c.now).toISOString();
    const signals = await inChunks([...c.accounts.keys()], (ids) => c.db.competitor_signal.all({ account_id: ids, observed_at: { op: "gte", value: since } }));
    const groups = new Map<string, Row<"competitor_signal">[]>();
    for (const s of signals) {
      const terr = c.accounts.get(s.account_id)?.territory_id;
      if (!terr || s.observed_at > until) continue;
      const key = `${terr}|${s.competitor_id}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
    }
    const territories = new Map((await c.db.territory.all()).map((t) => [t.id, t]));
    const competitors = new Map((await c.db.competitor.all()).map((x) => [x.id, x]));
    const week = startOfWeek(c.day);
    const out: Candidate[] = [];
    for (const [key, list] of groups) {
      if (list.length < k) continue;
      const [terrId, compId] = key.split("|") as [string, string];
      const terr = territories.get(terrId);
      const reporterManager = c.users.get(list[0]!.reported_by)?.manager_id;
      const to = active(c, terr?.manager_id) ?? active(c, reporterManager);
      if (!to) continue;
      out.push({ alert_type_code: "competition_wave", recipient_id: to, territory_id: terrId, competitor_id: compId,
        dedupe_key: `competition_wave:${terrId}:${compId}:${week}`,
        message: `${list.length} ${competitors.get(compId)?.name ?? "competitor"} signals in ${terr?.name ?? "a territory"} in the last ${win} days` });
    }
    return out;
  },
  async visit_overdue(c, rule) {
    const k = num(rule.threshold_value, 1);
    const list = customers(c);
    const cats = new Map((await c.db.account_category.all()).map((x) => [x.id, x.default_visit_frequency_days ?? null]));
    const visits = await inChunks(list.map((a) => a.id), (ids) => c.db.visit.all({ account_id: ids, status: "done" }, { cap: 50_000 }));
    const last = new Map<string, string>();
    for (const v of visits) {
      const d = v.completed_at ? localDate(c.me.org, v.completed_at) : v.planned_date;
      if (d <= c.day && (last.get(v.account_id) ?? "") < d) last.set(v.account_id, d);
    }
    const out: Candidate[] = [];
    for (const a of list) {
      const to = active(c, a.owner_rep_id), lv = last.get(a.id);
      const freq = a.visit_frequency_days ?? (a.category_id ? cats.get(a.category_id) : null) ?? null;
      if (!to || !lv || freq == null) continue;
      const days = daysBetween(lv, c.day);
      if (!(days > k * freq)) continue;
      out.push({ alert_type_code: "visit_overdue", recipient_id: to, account_id: a.id, territory_id: a.territory_id ?? null,
        dedupe_key: `visit_overdue:${a.id}:${lv}`, message: `${a.name} was last visited ${days} days ago (every ${fmt(freq)} days)` });
    }
    return out;
  },
  async rep_not_logging(c, rule) {
    const n = Math.max(1, Math.round(num(rule.threshold_value, 2)));
    const days = previousWorkingDays(c.day, n);
    const range = dateRange(c.me.org, days[0]!, days[days.length - 1]!);
    const out: Candidate[] = [];
    for (const rep of [...c.users.values()].filter((u) => u.role_code === "rep" && u.status === "active")) {
      const to = active(c, rep.manager_id);
      if (!to) continue;
      const visits = await c.db.visit.count({ rep_id: rep.id, planned_date: days, status: ["planned", "done"] });
      if (visits === 0) continue;
      const logs = await c.db.voice_log.list({ rep_id: rep.id, recorded_at: { op: "gte", value: range.from } }, { limit: 1, and: [{ column: "recorded_at", operator: "lt", value: range.to }] });
      if (logs.total > 0) continue;
      out.push({ alert_type_code: "rep_not_logging", recipient_id: to, dedupe_key: `rep_not_logging:${rep.id}:${days[days.length - 1]}`,
        message: `${rep.full_name} had ${visits} visit${visits === 1 ? "" : "s"} and logged no voice notes in the last ${n} working days` });
    }
    return out;
  },
  async approval_overdue(c, rule) {
    const graceMs = num(rule.threshold_value, 0) * 60_000;
    const pending = await inChunks([...c.users.keys()], (ids) => c.db.approval.all({ requested_by: ids, status: "pending" }));
    return pending.flatMap((p) => {
      if (!p.due_at || !(Date.parse(p.due_at) + graceMs < c.now)) return [];
      const requester = c.users.get(p.requested_by);
      const to = active(c, requester?.manager_id) ?? active(c, p.approver_id);
      if (!to) return [];
      return [{ alert_type_code: "approval_overdue" as const, recipient_id: to, dedupe_key: `approval_overdue:${p.id}`,
        message: `A ${p.kind.replace("_", " ")} approval requested by ${requester?.full_name ?? "a rep"} is past its due time` }];
    });
  },
};

export interface EngineDeps { now?: () => number; push?: PushPlatform | null }

export function makeImpl(deps: EngineDeps = {}): Impl<"alerts-engine", Principal> {
  return async ({ req, db, me }) => {
    const now = (deps.now ?? Date.now)();
    const dry = req.dry_run === true;
    const day = today(me.org, now);
    const users = new Map((await db.app_user.all()).map((u) => [u.id, u]));
    const accounts = new Map((await db.account.all({}, { cap: 20_000 })).map((a) => [a.id, a]));
    const ctx: Ctx = { db, me, now, day, users, accounts };
    const rules = (await db.alert_rule.all({ enabled: true })).filter((r) => (ALERT_TYPES as readonly string[]).includes(r.alert_type_code));
    const types = new Map((await db.alert_type.all()).map((t) => [t.code, t]));
    const perType: Record<string, { candidates: number; created: number; duplicates: number }> = {};
    const errors: Array<{ type: string; message: string }> = [];
    const pushes: Array<{ alert_id: string; pushed: boolean; reason?: string }> = [];
    let processed = 0, created = 0;

    for (const rule of rules) {
      const code = rule.alert_type_code as AlertTypeCode;
      const stat = (perType[code] ??= { candidates: 0, created: 0, duplicates: 0 });
      let list: Candidate[];
      try { list = await EVALUATORS[code](ctx, rule); } catch (e) { errors.push({ type: code, message: String((e as Error)?.message ?? e) }); continue; }
      const type = types.get(code);
      const seen = new Set<string>();
      for (const cand of list) {
        if (seen.has(cand.dedupe_key)) continue;
        seen.add(cand.dedupe_key);
        processed++; stat.candidates++;
        if (await db.alert.findOne({ dedupe_key: cand.dedupe_key })) { stat.duplicates++; continue; }
        if (dry) { stat.created++; created++; continue; }
        let row: Row<"alert">;
        try {
          row = await db.alert.insert({ ...cand, severity: type?.default_severity ?? "medium", status: "open" } as never);
        } catch (e) {
          if ((e as { code?: string })?.code === conflict("").code) { stat.duplicates++; continue; } // lost a race: someone else inserted it
          throw e;
        }
        stat.created++; created++;
        const acc = row.account_id ? accounts.get(row.account_id) ?? null : null;
        const r: PushResult = await pushToRepAndTeams(deps.push ?? null, db, row.recipient_id, "alert.created", { alert: toCard(row, type ?? null, acc) });
        pushes.push({ alert_id: row.id, pushed: r.pushed, ...(r.reason ? { reason: r.reason } : {}) });
      }
    }
    return { processed, created, details: { dry_run: dry, today: day, rules: rules.length, per_type: perType, pushes, errors } };
  };
}

export const impl = makeImpl();

/** Cron entry: context.api (present with a service account) is handed to the push helper. */
export const handle = (context: FunctionContext & { params?: unknown; api?: PushPlatform["api"] }) =>
  defineCron("alerts-engine", makeImpl({ push: { api: context.api ?? null } }))({ ...context, data: cronData(context) });
