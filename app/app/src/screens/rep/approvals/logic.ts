import type { ApprovalCard, EventType, FunctionRequestMap, MercEvent } from "../../../contracts";

export type ApprovalFilter = "open" | "all";
export type Decision = FunctionRequestMap["approval-resolve"]["decision"];
export type CallOutcome = "queued" | "ringing" | "answered" | "no_answer" | "busy" | "voicemail" | "failed";
export type BadgeColor = "neutral" | "muted" | "blue" | "green" | "orange" | "red" | "teal" | "purple";

export const getApprovalId = (a: ApprovalCard): string => a.approval_id;

/** Still needs someone: waiting, failed to send, or escalated. */
export const isOpen = (a: ApprovalCard): boolean => a.status === "pending" || a.status === "failed" || a.status === "escalated";

/** The rep decides customer messages and conversions (REQ-APR-001); a failed send is retried by approving again. */
export const canResolve = (a: ApprovalCard): boolean =>
  (a.kind === "customer_message" || a.kind === "conversion") && (a.status === "pending" || a.status === "failed");

export const canEdit = (a: ApprovalCard): boolean => a.kind === "customer_message" && a.status === "pending";

/** Discounts and terms are decided by the manager; the rep can only follow them. */
export const isWaitingOnManager = (a: ApprovalCard): boolean =>
  (a.kind === "discount" || a.kind === "terms") && (a.status === "pending" || a.status === "escalated");

/** Open first, newest first; the open filter hides decided ones. */
export function getVisible(items: readonly ApprovalCard[], filter: ApprovalFilter): ApprovalCard[] {
  const list = filter === "open" ? items.filter(isOpen) : [...items];
  return list.sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.created_at.localeCompare(a.created_at));
}

export function createResolveBody(a: ApprovalCard, decision: Decision, finalBody?: string): FunctionRequestMap["approval-resolve"] {
  return decision === "edit_approve"
    ? { approval_id: a.approval_id, decision, final_body: finalBody ?? getEditBody(a) }
    : { approval_id: a.approval_id, decision };
}

export const getEditBody = (a: ApprovalCard): string => a.body ?? a.preview;

export const STATUS_COLOR: Record<ApprovalCard["status"], BadgeColor> = {
  pending: "orange",
  approved: "green",
  countered: "blue",
  sent: "green",
  failed: "red",
  rejected: "muted",
  expired: "muted",
  escalated: "purple",
};

export type ResultKey = "result.sent" | "result.approved" | "result.rejected" | "result.failed" | "result.status";

/** What to tell the rep after approval-resolve / approval-status answered. */
export function getResult(a: ApprovalCard): { key: ResultKey; kind: "success" | "info" | "error" } {
  switch (a.status) {
    case "sent":
      return { key: "result.sent", kind: "success" };
    case "approved":
      return { key: "result.approved", kind: "success" };
    case "rejected":
      return { key: "result.rejected", kind: "info" };
    case "failed":
      return { key: "result.failed", kind: "error" };
    default:
      return { key: "result.status", kind: "info" };
  }
}

export type LiveChange = { type: "approval"; approval: ApprovalCard } | { type: "call"; approvalId: string; outcome: CallOutcome } | null;

/** approval.created / approval.decided carry the card; manager_call.status the call outcome of a live discount. */
export function getLiveChange(e: MercEvent<EventType>): LiveChange {
  if (e.type === "approval.created" || e.type === "approval.decided") {
    return { type: "approval", approval: (e as MercEvent<"approval.decided">).payload.approval };
  }
  if (e.type === "manager_call.status") {
    const p = (e as MercEvent<"manager_call.status">).payload;
    return { type: "call", approvalId: p.approval_id, outcome: p.outcome };
  }
  return null;
}
