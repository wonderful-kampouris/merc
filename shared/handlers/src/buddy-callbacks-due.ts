// fn:buddy-callbacks-due (contracts/functions/buddy-callbacks-due.json, REQ-BUD-014/015). Every 5 minutes, per
// org (system principal): start buddy_call rows with status scheduled and due_at <= now through the same path as
// buddy-call-start "now", and time out started calls that never reported an outcome (-> no_answer -> one fallback).
import { type Impl, type Principal, type Row } from "../../core/src/index";
import { defineCronWithDeps, nowOf, startNow, type BuddyDeps } from "./buddy-call-start";
import { timeoutStaleCalls } from "./buddy-call-outcome";

export function makeImpl(deps: BuddyDeps = {}): Impl<"buddy-callbacks-due", Principal> {
  return async ({ req, db, me, platform }) => {
    const dryRun = req.dry_run === true;
    const now = nowOf(deps);
    const due = (await db.buddy_call.all({ status: "scheduled" }, { orderBy: [{ column: "due_at", direction: "asc" }] }))
      .filter((r) => Date.parse(r.due_at) <= now);
    const counts: Record<string, number> = { started: 0, sent: 0, failed: 0, scheduled: 0, skipped: 0 };
    const ids: string[] = [];
    let processed = 0;
    for (const row of due) {
      const user = await db.app_user.get(row.user_id); // org-scoped: rows of other orgs are skipped
      if (!user) { counts.skipped++; continue; }
      processed++;
      ids.push(row.id);
      if (dryRun) continue;
      if (user.status !== "active") {
        await db.buddy_call.update(row.id, { status: "cancelled", failure_reason: "user is not active" });
        counts.failed++;
        continue;
      }
      const out = await startNow(db, platform, deps, row as Row<"buddy_call">, user, me.org);
      counts[out.status] = (counts[out.status] ?? 0) + 1;
    }
    const timedOut = await timeoutStaleCalls(db, platform, deps, { dryRun });
    return {
      processed: processed + timedOut.length,
      created: counts.started + counts.sent,
      details: { dry_run: dryRun, due_ids: ids, ...counts, timed_out_ids: timedOut },
    };
  };
}
export const impl = makeImpl();
export const handle = defineCronWithDeps("buddy-callbacks-due", makeImpl);
