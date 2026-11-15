// fn:escalate (contracts/functions/escalate.json, scope account, REQ-BUD-011): "tell my manager".
// Creates a task for the caller's manager linked to the account (title carries the reason) and an open
// alert for the manager with the full context. Both rows or neither: the task is removed if the alert fails.
// Alert type: tbl:alert_type has no escalation code in the seed, so "escalation" is used when present and
// "promise_due" (high, follow-up) otherwise; reported as a contract change request.
import { addDays, defineFunction, invalid, notFound, requireAccount, today, zonedInstant, type Impl } from "../../core/src/index";

export const ESCALATION_TYPE = "escalation";
export const FALLBACK_TYPE = "promise_due";
export const DUE_TIME = "12:00";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const impl: Impl<"escalate"> = async ({ req, db, me }) => {
  const account = await requireAccount(db, me, req.account_id);
  const reason = req.reason.trim().replace(/\s+/g, " ");
  if (!reason) throw invalid("reason must not be empty");
  const manager = me.manager;
  if (!manager || manager.status !== "active") throw notFound("you have no active manager to escalate to", { user_id: me.id });

  const type = (await db.alert_type.get(ESCALATION_TYPE)) ? ESCALATION_TYPE : FALLBACK_TYPE;
  const task = await db.task.insert({
    owner_id: manager.id,
    account_id: account.id,
    title: clip(`${me.user.full_name} → ${account.name}: ${reason}`, 200),
    due_at: zonedInstant(me.org, addDays(today(me.org), 1), DUE_TIME),
    is_customer_promise: false,
    status: "open",
    source: "human",
  });
  try {
    const alert = await db.alert.insert({
      alert_type_code: type,
      recipient_id: manager.id,
      account_id: account.id,
      task_id: task.id,
      territory_id: account.territory_id ?? null,
      severity: "high",
      status: "open",
      dedupe_key: `escalation:${task.id}`,
      message: clip(`${me.user.full_name} escalated ${account.name}: ${reason}`, 1000),
    });
    return { task_id: task.id, alert_id: alert.id };
  } catch (e) {
    try { await db.task.delete(task.id); } catch { /* keep the original error */ }
    throw e;
  }
};

export const handle = defineFunction("escalate", impl);
