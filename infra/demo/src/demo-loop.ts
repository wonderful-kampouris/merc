// Pure parts of the demo reset (WP-DEMO-01, REQ-OPS-002): which J5 rows to delete, which seed rows to reset in full,
// and where to move the Café Miltos visit for --next-visit-in. No I/O here, so it is unit-tested offline.
import { todayIn } from "../../seed/src/tokens.ts";
import type { SeedTable } from "../../seed/src/seed.ts";

/** The J5 stars (seed ids, spec/contracts/seed). */
export const MILTOS_ACCOUNT = "59b5e454-cc4b-5fab-939b-a50c78e8aa9b";
export const MILTOS_VISIT = "dd6c531d-1412-5df9-8f6e-5df01556c7a8";
/** The previsit cron runs every 5 minutes; the brief goes out once start - now <= lead (org default 30). */
export const CRON_EVERY_MIN = 5;
export const DEFAULT_LEAD_MIN = 30;

export type Row = Record<string, unknown>;
/** Existing platform rows of the tables the meeting loop writes, keyed by table name (data only). */
export type Snapshot = Partial<Record<LoopTable, Row[]>>;
export type LoopTable = (typeof DELETE_ORDER)[number];

/**
 * Children first, so no restrict FK blocks a delete (contracts/tables: order_line cascades from sales_order,
 * debrief_confirmation cascades from voice_log, the rest are set_null; restrict FKs all point at seed parents).
 */
export const DELETE_ORDER = [
  "rep_feedback", "ai_action", "debrief_confirmation", "visit_brief", "buddy_call", "activity", "order_line",
  "sales_order", "task", "problem", "deal", "visit_change", "visit", "voice_log",
] as const;

/** Tables whose Miltos seed rows are reset column by column (missing seed columns become null). */
export const FULL_RESET_TABLES = ["visit", "problem", "task", "deal", "sales_order"] as const;

const str = (v: unknown) => (v == null ? "" : String(v));

/**
 * Rows the J5 run created around Café Miltos: anything on the Miltos account or visit that is not a seed row, plus
 * the rows that hang off those (order lines, AI actions, buddy calls, feedback). Seed rows are never deleted; the
 * converge step puts them back. Rows of other accounts and other reps are never touched.
 */
export function cleanupPlan(snap: Snapshot, seedIds: Record<string, Set<string>>): Record<LoopTable, string[]> {
  const isSeed = (t: string, id: string) => seedIds[t]?.has(id) ?? false;
  const rows = (t: LoopTable) => snap[t] ?? [];
  const pick = (t: LoopTable, f: (r: Row) => boolean) => rows(t).filter((r) => !isSeed(t, str(r.id)) && f(r)).map((r) => str(r.id));
  const onMiltos = (r: Row) => r.account_id === MILTOS_ACCOUNT || r.visit_id === MILTOS_VISIT;

  const visits = new Set(pick("visit", (r) => r.account_id === MILTOS_ACCOUNT));
  const allVisits = new Set([...visits, MILTOS_VISIT]);
  const voiceLogs = new Set(pick("voice_log", (r) => onMiltos(r) || allVisits.has(str(r.visit_id))));
  const viaVoice = (r: Row) => voiceLogs.has(str(r.voice_log_id));
  const briefs = new Set(pick("visit_brief", (r) => onMiltos(r) || allVisits.has(str(r.visit_id))));
  const confs = new Set(pick("debrief_confirmation", (r) => allVisits.has(str(r.visit_id)) || viaVoice(r)
    || voiceLogs.has(str(r.correction_voice_log_id))));
  const orders = new Set(pick("sales_order", (r) => r.account_id === MILTOS_ACCOUNT));
  const tasks = new Set(pick("task", (r) => r.account_id === MILTOS_ACCOUNT));
  const problems = new Set(pick("problem", (r) => r.account_id === MILTOS_ACCOUNT));
  const deals = new Set(pick("deal", (r) => r.account_id === MILTOS_ACCOUNT));
  const activities = new Set(pick("activity", (r) => onMiltos(r) || allVisits.has(str(r.visit_id)) || viaVoice(r)));
  const touched = new Set([...orders, ...tasks, ...problems, ...deals, ...briefs, ...confs, ...visits, ...activities]);
  const buddyCalls = new Set(pick("buddy_call", (r) => allVisits.has(str(r.ref_id)) || briefs.has(str(r.ref_id)) || confs.has(str(r.ref_id))));
  for (const t of ["visit_brief", "debrief_confirmation"] as const)
    for (const r of rows(t)) if ((t === "visit_brief" ? briefs : confs).has(str(r.id)) && r.buddy_call_id) buddyCalls.add(str(r.buddy_call_id));

  return {
    rep_feedback: pick("rep_feedback", (r) => r.account_id === MILTOS_ACCOUNT || briefs.has(str(r.visit_brief_id)) || confs.has(str(r.debrief_confirmation_id))),
    // An AI action on a seed row (e.g. the grinder problem) is still a J5 artefact when its voice log is.
    ai_action: pick("ai_action", (r) => viaVoice(r) || touched.has(str(r.target_id))
      || (str(r.target_id) === MILTOS_VISIT || str(r.target_id) === MILTOS_ACCOUNT)),
    debrief_confirmation: [...confs],
    visit_brief: [...briefs],
    buddy_call: rows("buddy_call").map((r) => str(r.id)).filter((id) => buddyCalls.has(id) && !isSeed("buddy_call", id)),
    activity: [...activities],
    order_line: pick("order_line", (r) => orders.has(str(r.order_id))),
    sales_order: [...orders],
    task: [...tasks],
    problem: [...problems],
    deal: [...deals],
    visit_change: pick("visit_change", (r) => allVisits.has(str(r.visit_id))),
    visit: [...visits],
    voice_log: [...voiceLogs],
  };
}

/**
 * For the Miltos seed rows of FULL_RESET_TABLES, every column the seed leaves out is set to null, so converge also
 * clears what the run wrote (visit outcome/started_at/completed_at, a resolved_at on the grinder problem).
 * Mutates and returns the tables.
 */
export function withFullReset(seed: SeedTable[]): SeedTable[] {
  for (const t of seed) {
    if (!(FULL_RESET_TABLES as readonly string[]).includes(t.name)) continue;
    for (const r of t.rows) {
      if (r.account_id !== MILTOS_ACCOUNT) continue;
      for (const col of Object.keys(t.types)) if (!(col in r)) r[col] = null;
    }
  }
  return seed;
}

export interface Shift { planned_date: string; planned_start_at: string; status: "planned"; brief_due_at: string; brief_by: string }

/**
 * --next-visit-in <minutes>: the Miltos visit starts `minutes` from now (whole minute, UTC), today in the org
 * timezone, status planned. The previsit cron (every 5 min) sends the brief at its first tick with
 * start - now <= lead, so it lands between `brief_due_at` and `brief_by`.
 */
export function shiftVisit(now: number, minutes: number, tz: string, leadMin = DEFAULT_LEAD_MIN): Shift {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) throw new Error("--next-visit-in must be a whole number of minutes, 1..600");
  const start = Math.ceil((now + minutes * 60_000) / 60_000) * 60_000;
  const day = todayIn(tz, now);
  if (todayIn(tz, start) !== day) throw new Error(`a visit ${minutes} min from now falls on another day in ${tz}; the previsit cron only briefs today's visits`);
  const due = Math.max(now, start - leadMin * 60_000);
  const tick = Math.ceil(due / (CRON_EVERY_MIN * 60_000)) * CRON_EVERY_MIN * 60_000;
  const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
  return { planned_date: day, planned_start_at: iso(start), status: "planned", brief_due_at: iso(due), brief_by: iso(Math.min(tick, start)) };
}

export const DEFAULT_PROMPT_MIN = 10;

/**
 * --prompt-now: the Miltos visit (planned_duration_min, default 30) ended `promptMin` + 1 minutes ago, so the
 * post-visit cron asks "How did it go at Café Miltos?" at its next 5-minute tick. Same day rule as shiftVisit.
 */
export function promptNow(now: number, tz: string, durationMin = 30, promptMin = DEFAULT_PROMPT_MIN): Omit<Shift, "brief_due_at" | "brief_by"> & { prompt_by: string } {
  const start = Math.floor(now / 60_000) * 60_000 - (durationMin + promptMin + 1) * 60_000;
  const day = todayIn(tz, now);
  if (todayIn(tz, start) !== day) throw new Error(`the visit would start on another day in ${tz}; the post-visit cron only prompts today's visits`);
  const tick = Math.ceil(now / (CRON_EVERY_MIN * 60_000)) * CRON_EVERY_MIN * 60_000;
  const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
  return { planned_date: day, planned_start_at: iso(start), status: "planned", prompt_by: iso(tick) };
}

/** Run `fn` over `items` with at most `n` in flight; results keep input order. */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}
