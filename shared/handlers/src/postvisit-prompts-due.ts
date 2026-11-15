// fn:postvisit-prompts-due (contracts/functions/postvisit-prompts-due.json, REQ-MTG-005). Every 5 minutes, per org
// (system principal): a visit of today, still planned, whose planned_start_at + planned_duration_min +
// postvisit_prompt_minutes has passed, with no debrief and no earlier post_visit prompt, gets exactly one prompt
// "How did it go at <account>?" through buddy-call-start purpose post_visit.
// Channel: a call when the rep's notify_channel is call and we are inside call hours, else WhatsApp
// (a post-visit question must not turn into a call next morning). Merc never records the customer meeting.
import { today, withinLocalHours, type Impl, type Principal } from "../../core/src/index";
import { CALL_HOURS, defineCronWithDeps, nowOf, requestBuddyCall, type BuddyDeps } from "./buddy-call-start";

export const DEFAULT_PROMPT_MIN = 10;
export const DEFAULT_DURATION_MIN = 30;

export function makeImpl(deps: BuddyDeps = {}): Impl<"postvisit-prompts-due", Principal> {
  return async ({ req, db, me, platform }) => {
    const dryRun = req.dry_run === true;
    const now = nowOf(deps);
    const promptMin = Number(me.org.postvisit_prompt_minutes ?? DEFAULT_PROMPT_MIN) || DEFAULT_PROMPT_MIN;
    const day = today(me.org, now);
    const visits = (await db.visit.all({ planned_date: day, status: "planned" })).filter((v) => {
      const start = v.planned_start_at ? Date.parse(v.planned_start_at) : NaN;
      const due = start + (Number(v.planned_duration_min ?? DEFAULT_DURATION_MIN) || DEFAULT_DURATION_MIN) * 60_000 + promptMin * 60_000;
      return Number.isFinite(start) && due <= now;
    });
    let processed = 0, created = 0;
    const prompted: string[] = [], skipped: Array<{ visit_id: string; why: string }> = [];
    for (const v of visits) {
      const start = Date.parse(v.planned_start_at!);
      const logs = await db.voice_log.all({ rep_id: v.rep_id, account_id: v.account_id });
      if (logs.some((l) => l.visit_id === v.id || Date.parse(l.recorded_at) >= start)) { skipped.push({ visit_id: v.id, why: "debriefed" }); continue; }
      if ((await db.buddy_call.all({ user_id: v.rep_id, purpose: "post_visit" })).some((c) => c.ref_id === v.id)) continue;
      const user = await db.app_user.get(v.rep_id);
      if (!user || user.status !== "active") { skipped.push({ visit_id: v.id, why: "rep not active" }); continue; }
      processed++;
      if (dryRun) { prompted.push(v.id); continue; }
      const channel = user.notify_channel === "call" && withinLocalHours(me.org, CALL_HOURS.start, CALL_HOURS.end, now) ? "call" : "whatsapp";
      const out = await requestBuddyCall(db, platform, deps, user, me.org, { channel, purpose: "post_visit", ref_table: "visit", ref_id: v.id });
      if (out.status === "started" || out.status === "sent") created++;
      prompted.push(v.id);
    }
    return { processed, created, details: { dry_run: dryRun, prompted_visit_ids: prompted, skipped } };
  };
}

export const impl = makeImpl();
export const handle = defineCronWithDeps("postvisit-prompts-due", makeImpl);
