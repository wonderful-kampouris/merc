// fn:approval-resolve (contracts/functions/approval-resolve.json, REQ-APR-001/002, REQ-DEB-005): the rep approves,
// edits-then-approves or rejects a customer_message (or conversion) approval. Approve sends synchronously through
// message-send in the caller's own identity; approving twice never sends twice (sent -> returned as is).
import { assertApprover, conflict, defineFunction, forbidden, invalid, type Db, type Impl, type PlatformLike, type UserPrincipal } from "../../core/src/index";
import { repChannel, push, type ApiLike } from "../../live/src/index";
import { approvalCard, loadApproval, type ApprovalRow } from "./approvals-list";
import { sendApproved, type IntegrationsLike } from "./message-send";

export type Via = "app" | "voice_buddy";
export interface ResolveDeps { integrations?: IntegrationsLike | null; api?: ApiLike | null; via?: Via; now?: () => number }

async function decide(db: Db, me: UserPrincipal, a: ApprovalRow, status: "approved" | "rejected", via: Via, at: string): Promise<void> {
  await db.approval.update(a.id, { status, decided_by: me.id, decided_at: at, decided_via: via });
  if (a.ai_action_id && status === "rejected") {
    const act = await db.ai_action.get(a.ai_action_id);
    if (act && act.status === "suggested") await db.ai_action.update(act.id, { status: "rejected" });
  }
}

export function makeImpl(deps: ResolveDeps = {}): Impl<"approval-resolve"> {
  const via = deps.via ?? "app";
  const now = deps.now ?? Date.now;
  return async ({ req, db, me, platform }) => {
    const a = await loadApproval(db, req.approval_id);
    assertApprover(me, a);
    if (a.kind !== "customer_message" && a.kind !== "conversion") throw invalid(`${a.kind} approvals are decided with approval-decide`, { kind: a.kind });
    const at = new Date(now()).toISOString();
    let changed = false;

    if (req.decision === "reject") {
      if (a.status === "rejected") return { approval: await approvalCard(db, a) };
      if (a.status !== "pending" && a.status !== "failed") throw conflict(`approval is ${a.status}; it can no longer be rejected`, { status: a.status });
      await decide(db, me, a, "rejected", via, at);
      changed = true;
    } else if (a.kind === "conversion") {
      // The conversion itself is applied by fn:account-convert once approved (WP-CRM-01).
      if (req.decision === "edit_approve") throw invalid("a conversion approval cannot be edited");
      if (a.status === "approved") return { approval: await approvalCard(db, a) };
      if (a.status !== "pending") throw conflict(`approval is ${a.status}; it can no longer be approved`, { status: a.status });
      await decide(db, me, a, "approved", via, at);
      changed = true;
    } else {
      if (a.status === "sent") return { approval: await approvalCard(db, a) };            // idempotent: never send twice
      if (!["pending", "approved", "failed"].includes(a.status)) throw conflict(`approval is ${a.status}; it can no longer be approved`, { status: a.status });
      if (me.id !== a.requested_by) throw forbidden("only the rep who owns this message can approve sending it from their own account");
      if (req.decision === "edit_approve") {
        const body = req.final_body?.trim();
        if (!body) throw invalid("edit_approve needs a non-empty final_body");
        const m = await db.message_approval.findOne({ approval_id: a.id });
        if (!m) throw invalid("approval has no message");
        await db.message_approval.update(m.id, { final_body: body });
      }
      if (a.status === "pending") await decide(db, me, a, "approved", via, at);
      await sendApproved(db, me, platform as PlatformLike, { integrations: deps.integrations ?? null, now }, a.id);
      changed = true;
    }

    const card = await approvalCard(db, await loadApproval(db, a.id));
    if (changed) {
      const to = [...new Set([repChannel(a.requested_by), repChannel(a.approver_id)])];
      await push({ api: deps.api ?? null }, "approval.decided", { approval: card }, to, { now });
    }
    return { approval: card };
  };
}
/** Default impl (no provider): the buddy tool builds its own with makeImpl({integrations: ctx.integrations, via: "voice_buddy"}). */
export const impl = makeImpl();

type Ctx = Parameters<ReturnType<typeof defineFunction>>[0] & { integrations?: IntegrationsLike; api?: ApiLike };
export const handle = (context: Ctx) => defineFunction("approval-resolve", makeImpl({ integrations: context.integrations ?? null, api: context.api ?? null, via: "app" }))(context);
