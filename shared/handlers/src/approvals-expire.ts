// fn:approvals-expire (contracts/functions/approvals-expire.json, REQ-APR-003), cron "0 * * * *": pending
// customer_message approvals older than organization.approval_expiry_hours (or past their expires_at) -> expired.
// Runs per org with a system principal; it never sends anything.
import { defineCron, type Impl, type Principal } from "../../core/src/index";
import { push, repChannel, type ApiLike } from "../../live/src/index";
import { approvalCard, msOf } from "./approvals-list";

export interface ExpireDeps { api?: ApiLike | null; now?: () => number }

export function makeImpl(deps: ExpireDeps = {}): Impl<"approvals-expire", Principal> {
  const now = deps.now ?? Date.now;
  return async ({ req, db, me }) => {
    const hours = me.org.approval_expiry_hours;
    const t = now();
    const users = (await db.app_user.all()).map((u) => u.id);
    const pending = await db.approval.all({ kind: "customer_message", status: "pending", requested_by: users });
    const stale = pending.filter((a) => (a.expires_at ? Date.parse(a.expires_at) : msOf(a.created_at) + hours * 3_600_000) <= t);
    const at = new Date(t).toISOString();
    if (!req.dry_run) {
      for (const a of stale) {
        await db.approval.update(a.id, { status: "expired", decided_at: at, decision_note: `expired after ${hours} h without a decision` });
        const card = await approvalCard(db, (await db.approval.get(a.id))!);
        await push({ api: deps.api ?? null }, "approval.decided", { approval: card }, repChannel(a.requested_by), { now });
      }
    }
    return { processed: pending.length, created: 0, details: { expired: stale.length, approval_ids: stale.map((a) => a.id), dry_run: !!req.dry_run, expiry_hours: hours } };
  };
}
export const impl = makeImpl();

type Ctx = Parameters<ReturnType<typeof defineCron>>[0] & { api?: ApiLike };
/** Cron entry: once per organization with a system principal. */
export const handle = (context: Ctx) => defineCron("approvals-expire", makeImpl({ api: context.api ?? null }))(context);
