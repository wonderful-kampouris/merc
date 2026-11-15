// fn:discount-request (contracts/functions/discount-request.json): REQ-DSC-002 (tier 2, live call), REQ-DSC-006
// (tier 3, async), REQ-APV-003 (08:00-20:00 org time). One POST /v1/agents/outbound per request (spike S7); any
// reason the call cannot start (hours, flag, caller id, service account, provider error) degrades to async and the
// reason is logged. Only the approver's own app_user.phone is ever dialled (never a customer or outside number).
import {
  globalString, invalid, forbidden, requireAccount,
  type Db, type Impl, type PlatformLike, type Row,
} from "../../core/src/index";
import { push, repChannel, type Logger } from "../../live/src/index";
import {
  ANSWER_TIMEOUT_S, CALL_BLOCK_TEXT, GLOBAL_APPROVER_CALLER_ID, OUTBOUND_PATH, accountRef, callBlock, checkPct, defineWithApi,
  firstName, isoAt, nowOf, pct, pickApprover, resolveLimit, userRef, type DiscountDeps,
} from "./discount-check";

const defaultLog: Logger = (level, message, details) => (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(`[merc-discount] ${message}${details ? " " + JSON.stringify(details) : ""}`);
export const logOf = (d: DiscountDeps): Logger => d.log ?? defaultLog;

// ---- the approval card (contracts/_defs.json ApprovalCard), shared with list / decide / events ---------------
export async function approvalCard(db: Db, a: Row<"approval">, dr?: Row<"discount_request"> | null) {
  const d = dr === undefined ? await db.discount_request.findOne({ approval_id: a.id }) : dr;
  const [by, approver, account] = await Promise.all([db.app_user.require(a.requested_by), db.app_user.require(a.approver_id), d ? db.account.get(d.account_id) : Promise.resolve(null)]);
  const decided = a.status === "approved" || a.status === "countered" ? ` -> ${pct(d?.approved_pct ?? 0)}` : a.status === "rejected" ? " -> rejected" : "";
  const preview = d ? `${by.full_name}: ${pct(d.requested_pct)} for ${account?.name ?? "an account"} (limit ${pct(d.policy_limit_pct)})${decided}` : `${by.full_name}: ${a.kind} approval`;
  return {
    approval_id: a.id, kind: a.kind, status: a.status, mode: a.mode,
    account: account ? accountRef(account) : null, requested_by: userRef(by), approver: userRef(approver), preview,
    channel: null, recipient: null, subject: null, body: null,
    requested_pct: d?.requested_pct ?? null, policy_limit_pct: d?.policy_limit_pct ?? null, approved_pct: d?.approved_pct ?? null,
    decision_note: a.decision_note ?? null, due_at: a.due_at ?? null, expires_at: a.expires_at ?? null,
    created_at: isoAt(typeof a.created_at === "number" ? a.created_at : Date.parse(String(a.created_at ?? 0)) || 0),
  };
}

/** Approvals have no org_id column: an approval belongs to the org of its requester. */
export async function requireApproval(db: Db, id: string): Promise<Row<"approval">> {
  const a = await db.approval.require(id);
  if (!(await db.app_user.get(a.requested_by))) throw forbidden("approval is outside your organization");
  return a;
}

// ---- tier 3: async -----------------------------------------------------------------------------------
/** Deterministic, so approval-decide can close it again. */
export const waitingTaskTitle = (approver: Row<"app_user">, requestedPct: number, account: { name: string }) =>
  `Waiting for ${firstName(approver)}: ${pct(requestedPct)} discount for ${account.name}`;

export interface AsyncResult { due_at: string; task_id: string; pushed: boolean }
/**
 * Switch an approval to async (REQ-DSC-006): due_at = now + approval_sla_minutes (metrics.md#approval-sla),
 * approval.created push to the approver (the inbox is manager-approvals-list), a task for the requester.
 * SMS is skipped: no SMS-capable sender exists in the tenant (spike S8). Idempotent per approval.
 */
export async function goAsync(db: Db, platform: PlatformLike & { api?: unknown }, deps: DiscountDeps, a: Row<"approval">, reason: string): Promise<AsyncResult> {
  const now = nowOf(deps);
  const org = await db.organization.require(db.orgId!);
  const dr = await db.discount_request.findOne({ approval_id: a.id });
  if (!dr) throw invalid("approval has no discount request", { approval_id: a.id });
  const [approver, account] = await Promise.all([db.app_user.require(a.approver_id), db.account.require(dr.account_id)]);
  const due_at = isoAt(now + org.approval_sla_minutes * 60_000);
  const updated = await db.approval.update(a.id, { mode: "async", due_at });
  const title = waitingTaskTitle(approver, dr.requested_pct, account);
  const existing = await db.task.findOne({ owner_id: a.requested_by, account_id: account.id, title, status: "open" });
  const task = existing ?? await db.task.insert({ owner_id: a.requested_by, account_id: account.id, deal_id: dr.deal_id ?? null, title, is_customer_promise: false, due_at, status: "open", source: "ai", voice_log_id: dr.voice_log_id ?? null });
  const log = logOf(deps);
  log("warn", `approval ${a.id} is async: ${reason}`, { due_at, sms: "skipped: no SMS sender in the tenant" });
  const p = await push(deps, "approval.created", { approval: await approvalCard(db, updated, dr) }, repChannel(approver.id), { now: deps.now, log });
  return { due_at, task_id: task.id, pushed: p.pushed };
}

// ---- tier 2: one outbound call ---------------------------------------------------------------------------
export type CallStart = { ok: true; call: Row<"manager_call"> } | { ok: false; call: Row<"manager_call"> | null; reason: string };
const idOf = (res: unknown): string | null => {
  const r = (res && typeof res === "object" && "data" in (res as object) ? (res as { data: unknown }).data : res) as Record<string, unknown> | null;
  for (const k of ["communication_id", "conversation_id", "id"]) if (r && typeof r[k] === "string" && r[k]) return r[k] as string;
  return null;
};
/** Dial the approver once. Refuses anyone who is not an active manager/admin above the requester in the same org. */
export async function startCall(db: Db, platform: PlatformLike, deps: DiscountDeps, a: Row<"approval">, requester: Row<"app_user">, approver: Row<"app_user">): Promise<CallStart> {
  if (approver.id === requester.id || approver.org_id !== requester.org_id || approver.status !== "active" || !["manager", "admin"].includes(approver.role_code)) {
    return { ok: false, call: null, reason: "approver is not an active manager/admin of this team; refusing to dial" };
  }
  const now = nowOf(deps);
  const from = globalString(platform, GLOBAL_APPROVER_CALLER_ID)!;
  const attempt_no = (await db.manager_call.count({ approval_id: a.id })) + 1;
  const call = await db.manager_call.insert({ approval_id: a.id, callee_id: approver.id, attempt_no, outcome: "queued", started_at: isoAt(now) });
  try {
    const res = await deps.api!.post(OUTBOUND_PATH, { body: { from, to: approver.phone, call_purpose: `merc_approval:${a.id}`, answer_timeout_after_progress_seconds: ANSWER_TIMEOUT_S } });
    const conv = idOf(res);
    const ringing = await db.manager_call.update(call.id, { outcome: "ringing", ...(conv ? { wonderful_conversation_id: conv } : {}) });
    await push(deps, "manager_call.status", { approval_id: a.id, outcome: "ringing" }, repChannel(requester.id), { now: deps.now, log: logOf(deps) });
    return { ok: true, call: ringing };
  } catch (e) {
    const status = (e as { status?: unknown })?.status;
    const failed = await db.manager_call.update(call.id, { outcome: "failed", ended_at: isoAt(nowOf(deps)) });
    return { ok: false, call: failed, reason: `outbound call could not start (${typeof status === "number" ? status : "error"}: ${String((e as Error)?.message ?? e).slice(0, 200)})` };
  }
}

// ---- fn:discount-request ------------------------------------------------------------------------------------
export function makeImpl(deps: DiscountDeps = {}): Impl<"discount-request"> {
  return async ({ req, db, me, platform }) => {
    checkPct(req.discount_pct);
    if (!req.lines.length) throw invalid("a discount request needs at least one line");
    for (const l of req.lines) if (!(l.quantity > 0)) throw invalid("line quantity must be above 0", { product_id: l.product_id });
    const now = nowOf(deps);
    const account = await requireAccount(db, me, req.account_id);
    if (req.deal_id) {
      const deal = await db.deal.require(req.deal_id);
      if (deal.account_id !== account.id) throw invalid("deal belongs to another account", { deal_id: req.deal_id });
    }
    const productIds = req.lines.map((l) => l.product_id);
    const limit = await resolveLimit(db, me.org, me.user, account, productIds, now);
    if (req.discount_pct <= limit.limit_pct) throw invalid(`${pct(req.discount_pct)} is within your limit of ${pct(limit.limit_pct)}; no approval is needed (use discount-check)`, { limit_pct: limit.limit_pct });
    const { approver } = await pickApprover(db, me.org, me.user, account, productIds, req.discount_pct, now);

    const approval = await db.approval.insert({
      kind: "discount", requested_by: me.id, approver_id: approver.id, mode: req.mode, status: "pending",
      expires_at: isoAt(now + me.org.approval_expiry_hours * 3_600_000),
    });
    const dr = await db.discount_request.insert({
      approval_id: approval.id, account_id: account.id, deal_id: req.deal_id ?? null, policy_id: limit.policy_id,
      requested_pct: req.discount_pct, policy_limit_pct: limit.limit_pct, justification: req.justification ?? null,
      voice_log_id: req.voice_log_id ?? null, buddy_conversation_id: req.conversation_id ?? null,
    });
    for (const l of req.lines) await db.discount_request_line.insert({ discount_request_id: dr.id, product_id: l.product_id, quantity: l.quantity });

    let manager_call_id: string | null = null;
    let reason = "requested async";
    if (req.mode === "live") {
      const block = callBlock(me.org, approver, platform, deps);
      if (block) reason = `live call unavailable: ${CALL_BLOCK_TEXT[block]}`;
      else {
        const started = await startCall(db, platform, deps, approval, me.user, approver);
        manager_call_id = started.call?.id ?? null;
        if (started.ok) {
          logOf(deps)("info", `approval ${approval.id}: calling ${approver.full_name}`, { manager_call_id });
          return { approval_id: approval.id, status: approval.status, mode: "live", manager_call_id, approver: userRef(approver), due_at: null };
        }
        reason = started.reason;
      }
    }
    const asy = await goAsync(db, platform, deps, approval, reason);
    return { approval_id: approval.id, status: "pending", mode: "async", manager_call_id, approver: userRef(approver), due_at: asy.due_at };
  };
}
export const impl = makeImpl();
export const handle = defineWithApi("discount-request", makeImpl);
