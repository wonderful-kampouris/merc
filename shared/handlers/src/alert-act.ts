// fn:alert-act (contracts/functions/alert-act.json, REQ-ALR-002). Gate alerts.act, scope owner.
//   create_task  -> a task for the alert's recipient. For visit alerts (going_quiet, visit_overdue) it is
//                   "Visit <account>" due tomorrow 09:30 org time; otherwise "<suggested action>: <message>".
//                   The alert becomes done.
//   create_draft -> a customer-message draft through fn:draft-message (internal; never sends). The alert becomes done.
//                   Until fn:draft-message exists this answers blocked_by_policy naming it.
//   done/dismiss -> close the alert (repeating the same close is a no-op).
import { addDays, blocked, conflict, defineFunction, forbidden, invalid, isAdmin, notFound, today, zonedInstant, type Impl, type UserPrincipal } from "../../core/src/index";
import { cardsFor } from "./alerts-list";

export const VISIT_ALERTS = new Set(["going_quiet", "visit_overdue"]);
export const TASK_TIME = "09:30";

export interface DraftArgs { account_id: string; contact_id: null; intent: string; channel: "email"; context: string; on_behalf_of: string }
export type DraftFn = (args: DraftArgs, me: UserPrincipal) => Promise<{ approval_id: string; ai_action_id: string }>;
export interface AlertActDeps { now?: () => number; draft?: DraftFn | null }

const noDraft: DraftFn = async () => {
  throw blocked("alert-act create_draft is blocked: fn:draft-message is not deployed yet", {
    missing: "fn:draft-message", kind: "function", how: "build fn:draft-message (internal, contracts/functions/draft-message.json) and pass it to alert-act makeImpl({draft})",
  });
};

export function makeImpl(deps: AlertActDeps = {}): Impl<"alert-act"> {
  const draft = deps.draft ?? noDraft;
  return async ({ req, db, me }) => {
    const now = (deps.now ?? Date.now)();
    const alert = await db.alert.get(req.alert_id);
    // tbl:alert has no org_id: an alert belongs to the org of its recipient.
    const recipient = alert ? await db.app_user.get(alert.recipient_id) : null;
    if (!alert || !recipient) throw notFound("alert not found", { alert_id: req.alert_id });
    if (!isAdmin(me) && alert.recipient_id !== me.id) throw forbidden("alert is outside your scope");
    const nowIso = new Date(now).toISOString();
    let task_id: string | null = null, approval_id: string | null = null;

    if (req.action === "done" || req.action === "dismiss") {
      const target = req.action === "done" ? "done" : "dismissed";
      if (alert.status !== target) {
        if (alert.status !== "open") throw conflict(`alert is already ${alert.status}`);
        await db.alert.update(alert.id, { status: target, resolved_at: nowIso });
      }
    } else {
      if (alert.status !== "open") throw conflict(`alert is already ${alert.status}`);
      const type = await db.alert_type.get(alert.alert_type_code);
      const account = alert.account_id ? await db.account.get(alert.account_id) : null;
      if (req.action === "create_task") {
        const day = addDays(today(me.org, now), 1);
        const title = VISIT_ALERTS.has(alert.alert_type_code) && account
          ? `Visit ${account.name}`
          : `${type?.suggested_action ?? "Follow up"}: ${alert.message}`.slice(0, 200);
        const task = await db.task.insert({
          account_id: alert.account_id ?? null, owner_id: alert.recipient_id, deal_id: alert.deal_id ?? null, title,
          is_customer_promise: false, due_at: zonedInstant(me.org, day, TASK_TIME), status: "open", source: "human",
        } as never);
        task_id = task.id;
        await db.alert.update(alert.id, { status: "done", resolved_at: nowIso, ...(alert.task_id ? {} : { task_id: task.id }) });
      } else {
        if (!account) throw invalid("this alert has no account to write to");
        const out = await draft({ account_id: account.id, contact_id: null, intent: type?.suggested_action ?? alert.alert_type_code, channel: "email", context: alert.message, on_behalf_of: me.id }, me);
        approval_id = out.approval_id;
        await db.alert.update(alert.id, { status: "done", resolved_at: nowIso });
      }
    }
    const [card] = await cardsFor(db, [(await db.alert.require(alert.id))]);
    return { alert: card!, task_id, approval_id };
  };
}

export const impl = makeImpl();
export const handle = defineFunction("alert-act", impl);
