// fn:approval-sla-watch (cron */5, contracts/functions/approval-sla-watch.json, REQ-DSC-006/007).
// 1. Lazy no-answer: live calls without an outcome after 90 s -> no_answer -> async.
// 2. metrics.md#approval-sla: async discount approvals still pending past due_at -> status escalated, approver =
//    the approver's manager, or an admin when there is none; approval_overdue alert for the new approver; push.
//    SMS to both sides is skipped and reported: the tenant has no SMS-capable sender (spike S8).
import { type Db, type Impl, type Principal, type Row } from "../../core/src/index";
import { push, repChannel } from "../../live/src/index";
import { defineCronWithApi, isoAt, nowOf, pct, type DiscountDeps } from "./discount-check";
import { approvalCard, logOf } from "./discount-request";
import { timeoutStaleCalls } from "./manager-call-outcome";

export const SMS_SKIPPED = "skipped: no SMS-capable sender in the tenant (spike S8)";

export async function escalationTarget(db: Db, approver: Row<"app_user">): Promise<Row<"app_user">> {
  const m = approver.manager_id ? await db.app_user.get(approver.manager_id) : null;
  if (m && m.status === "active" && (m.role_code === "manager" || m.role_code === "admin")) return m;
  const admin = (await db.app_user.all({ role_code: "admin", status: "active" })).filter((u) => u.id !== approver.id).sort((a, b) => a.id.localeCompare(b.id))[0];
  return admin ?? approver;
}

export function makeImpl(deps: DiscountDeps = {}): Impl<"approval-sla-watch", Principal> {
  return async ({ req, db, platform }) => {
    const dry = req.dry_run === true;
    const now = nowOf(deps);
    const org = await db.organization.require(db.orgId!);
    const timedOut = await timeoutStaleCalls(db, platform, deps, { dryRun: dry });
    const users = new Map((await db.app_user.all()).map((u) => [u.id, u]));
    const overdue = (await db.approval.all({ kind: "discount", status: "pending", mode: "async" }))
      .filter((a) => users.has(a.requested_by) && a.due_at && Date.parse(a.due_at) < now);
    let created = 0;
    const escalated: Array<{ approval_id: string; from: string; to: string }> = [];
    for (const a of overdue) {
      const from = users.get(a.approver_id) ?? (await db.app_user.require(a.approver_id));
      const to = await escalationTarget(db, from);
      escalated.push({ approval_id: a.id, from: from.id, to: to.id });
      if (dry) continue;
      const next = await db.approval.update(a.id, { status: "escalated", approver_id: to.id, due_at: isoAt(now + org.approval_sla_minutes * 60_000) });
      const dr = await db.discount_request.findOne({ approval_id: a.id });
      const account = dr ? await db.account.get(dr.account_id) : null;
      const dedupe_key = `approval_overdue:${a.id}`;
      if (!(await db.alert.findOne({ dedupe_key }))) {
        const requester = users.get(a.requested_by)!;
        await db.alert.insert({ alert_type_code: "approval_overdue", recipient_id: to.id, account_id: account?.id ?? null, severity: "high", status: "open", dedupe_key,
          message: `Overdue: ${requester.full_name} asked ${from.full_name} for ${dr ? pct(dr.requested_pct) : "a"} discount${account ? ` for ${account.name}` : ""}; now escalated to you` });
        created++;
      }
      await push(deps, "approval.created", { approval: await approvalCard(db, next, dr) }, repChannel(to.id), { now: deps.now, log: logOf(deps) });
    }
    if (escalated.length) logOf(deps)("warn", `escalated ${escalated.length} overdue approval(s); SMS ${SMS_SKIPPED}`);
    return { processed: overdue.length + timedOut.length, created, details: { dry_run: dry, escalated, timed_out_calls: timedOut, sms: escalated.length ? SMS_SKIPPED : null } };
  };
}
export const impl = makeImpl();
export const handle = defineCronWithApi("approval-sla-watch", makeImpl);
