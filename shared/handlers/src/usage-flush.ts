// fn:usage-flush (contracts/functions/usage-flush.json, REQ-SET-005): cron */30. Per org, recounts usage per user per
// local day (org timezone) for the last WINDOW_DAYS days from the rows the other functions already write, and
// converges tbl:usage_event (user_id, day, kind) to those totals. Recounting instead of adding deltas makes every run
// idempotent: two overlapping runs give the same totals ("atomic increase" without a counter store).
//   voice_minutes          voice_log (rep, recorded_at); minutes estimated from transcript words / 140 wpm, min 0.1
//                          per non-typed log (voice_log has no duration column: see report)
//   llm_calls              ai_action (on_behalf_of, created_at): one per AI-proposed action
//   research_runs          prospect_search (requested_by, created_at)
//   sms                    approval decided_via sms_link (approver, decided_at): the SMS link sent to the approver
//   outbound_call_minutes  manager_call (callee, started_at..ended_at)
//   emails_sent            message_approval channel email with sent_at (approval.requested_by)
// dry_run=true only counts. processed = source rows read, created = usage_event rows inserted.
import { addDays, defineCron, localDate, today, type Db, type Impl, type Principal } from "../../core/src/index";

export const SLUG = "usage-flush" as const;
export const WINDOW_DAYS = 2;
export const WORDS_PER_MINUTE = 140;
export type UsageKind = "voice_minutes" | "llm_calls" | "research_runs" | "sms" | "outbound_call_minutes" | "emails_sent";

const toMs = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && v) { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  return null;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Totals keyed `user|day|kind` for days >= fromDate. */
export async function countUsage(db: Db, me: Principal, fromDate: string) {
  const totals = new Map<string, number>();
  let processed = 0;
  const add = (user: string | null | undefined, at: unknown, kind: UsageKind, q: number) => {
    const ms = toMs(at);
    if (!user || ms == null || !(q > 0)) return;
    const day = localDate(me.org, ms);
    if (day < fromDate) return;
    const k = `${user}|${day}|${kind}`;
    totals.set(k, (totals.get(k) ?? 0) + q);
  };
  const userIds = (await db.app_user.all()).map((u) => u.id);
  const fromIso = new Date(toMs(`${addDays(fromDate, -1)}T00:00:00Z`)!).toISOString();
  if (!userIds.length) return { totals, processed };

  const logs = await db.voice_log.all({ rep_id: userIds, recorded_at: { op: "gte", value: fromIso } });
  for (const l of logs) {
    processed++;
    if (l.capture_mode === "typed") continue;
    const words = String(l.transcript ?? "").trim().split(/\s+/).filter(Boolean).length;
    add(l.rep_id, l.recorded_at, "voice_minutes", Math.max(0.1, words / WORDS_PER_MINUTE));
  }
  for (const a of await db.ai_action.all()) { processed++; add(a.on_behalf_of, a.created_at, "llm_calls", 1); }
  for (const s of await db.prospect_search.all()) { processed++; add(s.requested_by, s.created_at, "research_runs", 1); }

  const approvals = await db.approval.all({ requested_by: userIds });
  const requester = new Map(approvals.map((a) => [a.id, a.requested_by]));
  for (const a of approvals) { processed++; if (a.decided_via === "sms_link") add(a.approver_id, a.decided_at ?? a.created_at, "sms", 1); }
  const approvalIds = approvals.map((a) => a.id);
  if (approvalIds.length) {
    for (const c of await db.manager_call.all({ approval_id: approvalIds })) {
      processed++;
      const s = toMs(c.started_at), e = toMs(c.ended_at);
      if (s != null && e != null && e > s) add(c.callee_id, c.started_at, "outbound_call_minutes", (e - s) / 60_000);
    }
    for (const m of await db.message_approval.all({ approval_id: approvalIds, channel_code: "email", sent_at: { op: "is_not_null" } })) {
      processed++; add(requester.get(m.approval_id), m.sent_at, "emails_sent", 1);
    }
  }
  for (const [k, v] of totals) totals.set(k, k.endsWith("minutes") ? round1(v) : v);
  return { totals, processed };
}

export function makeImpl(now: () => number = Date.now): Impl<"usage-flush", Principal> {
  return async ({ req, db, me }) => {
    const dryRun = req.dry_run === true;
    const fromDate = addDays(today(me.org, now()), -(WINDOW_DAYS - 1));
    const { totals, processed } = await countUsage(db, me, fromDate);
    const userIds = (await db.app_user.all()).map((u) => u.id);
    const existing = userIds.length ? await db.usage_event.all({ user_id: userIds, day: { op: "gte", value: fromDate } }) : [];
    const have = new Map(existing.map((r) => [`${r.user_id}|${r.day}|${r.kind}`, r]));
    let created = 0, updated = 0;
    const byKind: Record<string, number> = {};
    for (const [k, q] of totals) {
      const [user_id, day, kind] = k.split("|");
      byKind[kind] = round1((byKind[kind] ?? 0) + q);
      const cur = have.get(k);
      if (dryRun) { if (!cur) created++; else if (cur.quantity !== q) updated++; continue; }
      if (!cur) { await db.usage_event.insert({ user_id, day, kind, quantity: q } as any); created++; }
      else if (cur.quantity !== q) { await db.usage_event.update(cur.id, { quantity: q }); updated++; }
    }
    return { processed, created, details: { from_date: fromDate, window_days: WINDOW_DAYS, dry_run: dryRun, updated, keys: totals.size, totals_by_kind: byKind, voice_minutes_estimated: true } };
  };
}

export const impl = makeImpl();
/** Cron entry: once per organization with a system principal (shared/core defineCron). */
export const handle = defineCron(SLUG, impl);
