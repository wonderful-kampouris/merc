// fn:manager-call-outcome (contracts/functions/manager-call-outcome.json, REQ-DSC-006). Called by merc-approver's
// OnVoicemailDetected / OnEnd triggers (report_call_outcome), and lazily (timeoutStaleCalls) by approval-sla-watch /
// approval-status when a live call has no outcome after 90 s. Any outcome other than `answered` on a still-pending
// live approval switches it to async (due_at from the SLA, approver push + inbox, requester task).
import { assertRequesterOrApprover, type Db, type Impl, type PlatformLike, type Principal, type Row } from "../../core/src/index";
import { push, repChannel } from "../../live/src/index";
import { NO_ANSWER_AFTER_MS, defineWithApi, isoAt, nowOf, type DiscountDeps } from "./discount-check";
import { goAsync, logOf, requireApproval } from "./discount-request";

type Outcome = "answered" | "no_answer" | "busy" | "voicemail" | "failed";
const OPEN: Row<"manager_call">["outcome"][] = ["queued", "ringing"];

export async function applyOutcome(db: Db, platform: PlatformLike, deps: DiscountDeps, call: Row<"manager_call">, approval: Row<"approval">, outcome: Outcome, conversationId: string | null = null): Promise<"none" | "async"> {
  if (OPEN.includes(call.outcome) || (call.outcome === "answered" && outcome !== "answered")) {
    await db.manager_call.update(call.id, {
      outcome: call.outcome === "answered" ? "answered" : outcome, // an answered call that ends without a decision stays answered
      ...(outcome !== "answered" ? { ended_at: isoAt(nowOf(deps)) } : {}),
      ...(conversationId ? { wonderful_conversation_id: conversationId } : {}),
    });
    await push(deps, "manager_call.status", { approval_id: approval.id, outcome }, repChannel(approval.requested_by), { now: deps.now, log: logOf(deps) });
  }
  if (outcome === "answered" || approval.status !== "pending" || approval.mode !== "live") return approval.mode === "async" && outcome !== "answered" ? "async" : "none";
  await goAsync(db, platform, deps, approval, `manager call ended without a decision (${outcome})`);
  return "async";
}

/** Lazy no-answer rule: live calls still queued/ringing 90 s after start become no_answer (and the approval async). */
export async function timeoutStaleCalls(db: Db, platform: PlatformLike, deps: DiscountDeps, opts: { dryRun?: boolean } = {}): Promise<string[]> {
  const cutoff = nowOf(deps) - NO_ANSWER_AFTER_MS;
  const stale = (await db.manager_call.all({ outcome: OPEN })).filter((c) => Date.parse(c.started_at) <= cutoff);
  const out: string[] = [];
  for (const c of stale) {
    const a = await db.approval.get(c.approval_id);
    if (!a || !(await db.app_user.get(a.requested_by))) continue; // other org
    out.push(c.id);
    if (!opts.dryRun) await applyOutcome(db, platform, deps, c, a, "no_answer");
  }
  return out;
}

export function makeImpl(deps: DiscountDeps = {}): Impl<"manager-call-outcome", Principal> {
  return async ({ req, db, me, platform }) => {
    const call = await db.manager_call.require(req.manager_call_id);
    const approval = await requireApproval(db, call.approval_id);
    if (me.kind === "user") assertRequesterOrApprover(me, approval);
    const fallback = await applyOutcome(db, platform, deps, call, approval, req.outcome, req.conversation_id ?? null);
    return { approval_id: approval.id, fallback };
  };
}
export const impl = makeImpl();
export const handle = defineWithApi("manager-call-outcome", makeImpl);
