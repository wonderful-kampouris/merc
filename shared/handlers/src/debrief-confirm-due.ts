// fn:debrief-confirm-due (contracts/functions/debrief-confirm-due.json, REQ-MTG-006 / REQ-MTG-007). Every minute,
// per org (system principal):
// - completed voice logs of the last 30 min without a debrief_confirmation get one (debrief-confirm-send path);
// - sent confirmations without a reply after 4 h become no_reply. The applied actions stay; they are undoable.
import { type Impl, type Principal } from "../../core/src/index";
import { defineCronWithDeps, isoAt, nowOf, type BuddyDeps } from "./buddy-call-start";
import { sendConfirmation } from "./debrief-confirm-send";

export const LOOKBACK_MIN = 30;
export const NO_REPLY_HOURS = 4;

export function makeImpl(deps: BuddyDeps = {}): Impl<"debrief-confirm-due", Principal> {
  return async ({ req, db, me, platform }) => {
    const dryRun = req.dry_run === true;
    const now = nowOf(deps);
    const recent = (await db.voice_log.all({ status: "completed", processed_at: { op: "gte", value: isoAt(now - LOOKBACK_MIN * 60_000) } }))
      .filter((v) => !!v.account_id && !!v.processed_at && Date.parse(v.processed_at) <= now);
    let processed = 0, created = 0;
    const confirmation_ids: string[] = [], errors: Array<{ voice_log_id: string; error: string }> = [];
    for (const vl of recent) {
      if (await db.debrief_confirmation.findOne({ voice_log_id: vl.id })) continue;
      const user = await db.app_user.get(vl.rep_id);
      if (!user || user.status !== "active") continue;
      processed++;
      if (dryRun) continue;
      try {
        const row = await sendConfirmation(db, platform, deps, vl, user, me.org);
        created++;
        confirmation_ids.push(row.id);
      } catch (e) { errors.push({ voice_log_id: vl.id, error: String((e as Error)?.message ?? e).slice(0, 200) }); }
    }
    const cutoff = now - NO_REPLY_HOURS * 3_600_000;
    const stale = (await db.debrief_confirmation.all({ status: "sent" })).filter((r) => !r.replied_at && !!r.sent_at && Date.parse(r.sent_at) <= cutoff);
    for (const r of stale) {
      processed++;
      if (!dryRun) await db.debrief_confirmation.update(r.id, { status: "no_reply" });
    }
    return { processed, created, details: { dry_run: dryRun, confirmation_ids, no_reply_ids: stale.map((r) => r.id), errors } };
  };
}

export const impl = makeImpl();
export const handle = defineCronWithDeps("debrief-confirm-due", makeImpl);
