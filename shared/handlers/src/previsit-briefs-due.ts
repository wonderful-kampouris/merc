// fn:previsit-briefs-due (contracts/functions/previsit-briefs-due.json, REQ-MTG-001). Every 5 minutes, per org:
// each planned visit of today whose planned_start_at is within previsit_lead_minutes (default 30) and that has no
// delivered brief gets one: the brief is built by the visit-brief-get impl AS THE VISIT'S REP (so scope, language and
// campaign exposure are the rep's), then delivered once through buddy-call-start purpose pre_visit.
// Channel: a call when the rep's notify_channel is call and we are inside call hours, else WhatsApp.
// Exactly one delivery attempt per visit: a failed delivery (channels not live, no WhatsApp) is recorded on the
// brief and the buddy_call row and is not retried.
import { defineCron, resolvePrincipal, today, withinLocalHours, type FunctionContext, type Impl, type PlatformLike, type Principal } from "../../core/src/index";
import { CALL_HOURS, depsFrom, isoAt, nowOf, requestBuddyCall, type BuddyDeps } from "./buddy-call-start";
import { defaultDeps as briefDefaultDeps, makeImpl as makeBriefImpl, type BriefDeps } from "./visit-brief-get";

export const DEFAULT_LEAD_MIN = 30;
export interface PrevisitDeps { buddy: BuddyDeps; brief: BriefDeps }

const briefStatus = (s: string): "sent" | "called" | "failed" | "generated" => (s === "sent" ? "sent" : s === "started" ? "called" : s === "failed" ? "failed" : "generated");

export function makeImpl(d: PrevisitDeps): Impl<"previsit-briefs-due", Principal> {
  return async ({ req, db, me, platform }) => {
    const dryRun = req.dry_run === true;
    const now = nowOf(d.buddy);
    const lead = Number(me.org.previsit_lead_minutes ?? DEFAULT_LEAD_MIN) || DEFAULT_LEAD_MIN;
    const day = today(me.org, now);
    const visits = (await db.visit.all({ planned_date: day, status: "planned" })).filter((v) => {
      const start = v.planned_start_at ? Date.parse(v.planned_start_at) : NaN;
      return Number.isFinite(start) && start > now && start - now <= lead * 60_000;
    });
    let processed = 0, created = 0;
    const counts = { sent: 0, called: 0, failed: 0, generated: 0 };
    const briefed: string[] = [], errors: Array<{ visit_id: string; error: string }> = [];
    for (const v of visits) {
      const existing = await db.visit_brief.findOne({ visit_id: v.id });
      if (existing && (existing.status !== "generated" || existing.buddy_call_id)) continue; // delivered (or tried) once
      const user = await db.app_user.get(v.rep_id);
      if (!user || user.status !== "active") continue;
      processed++;
      briefed.push(v.id);
      if (dryRun) continue;
      try {
        const rep = await resolvePrincipal(db.api, { kind: "app_user", appUserId: user.id, orgId: me.org.id });
        const brief = await makeBriefImpl({ ...d.brief, now: () => now })({ req: { visit_id: v.id } as never, db: db.withOrg(me.org.id), me: rep, platform });
        const channel = user.notify_channel === "call" && withinLocalHours(me.org, CALL_HOURS.start, CALL_HOURS.end, now) ? "call" : "whatsapp";
        const out = await requestBuddyCall(db, platform, d.buddy, user, me.org, { channel, purpose: "pre_visit", ref_table: "visit_brief", ref_id: brief.visit_brief_id });
        const status = briefStatus(out.status);
        await db.visit_brief.update(brief.visit_brief_id, {
          channel, status, buddy_call_id: out.row.id, ...(status === "sent" || status === "called" ? { sent_at: isoAt(now) } : {}),
        });
        counts[status]++;
        if (status === "sent" || status === "called") created++;
      } catch (e) { errors.push({ visit_id: v.id, error: String((e as Error)?.message ?? e).slice(0, 200) }); }
    }
    return { processed, created, details: { dry_run: dryRun, lead_minutes: lead, visit_ids: briefed, ...counts, errors } };
  };
}

/** Deployed cron entry: buddy deps (context.api, context.outbound) + brief deps (merc-write, KB merc-company). */
export function handle(context: FunctionContext & { api?: unknown }) {
  const platform: PlatformLike = { globals: context.globals ?? null };
  return defineCron("previsit-briefs-due", makeImpl({ buddy: depsFrom(context), brief: briefDefaultDeps(context.api as never, platform) }))(context);
}
