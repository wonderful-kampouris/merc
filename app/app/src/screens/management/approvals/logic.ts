import type { ApprovalCard, FunctionRequestMap } from "../../../contracts";

/** Pure logic of the mobile approvals screen (REQ-DSC-009). No React here, so it stays unit-testable. */

export type Decision = "approve" | "counter" | "reject";
export type DueState = "overdue" | "soon" | "ok" | "none";
export type ListFilter = "pending" | "all";

const SOON_MS = 15 * 60 * 1000;
const OPEN = new Set<ApprovalCard["status"]>(["pending", "escalated"]);

/** An approval the manager can still decide (pending, or escalated to them). */
export const isOpen = (a: Pick<ApprovalCard, "status">): boolean => OPEN.has(a.status);

/** Discount approvals can be countered; other kinds are approve/reject only. */
export const canCounter = (a: Pick<ApprovalCard, "kind" | "requested_pct">): boolean =>
  a.kind === "discount" && typeof a.requested_pct === "number" && a.requested_pct > 0;

/** Due-time state for the SLA badge (metrics.md#approval-sla). */
export function dueState(a: Pick<ApprovalCard, "due_at" | "status">, now: Date = new Date()): DueState {
  if (!a.due_at || !isOpen(a)) return "none";
  const left = Date.parse(a.due_at) - now.getTime();
  if (Number.isNaN(left)) return "none";
  if (left < 0) return "overdue";
  return left <= SOON_MS ? "soon" : "ok";
}

/** Minutes until due (negative when overdue), rounded toward zero. */
export const minutesLeft = (dueAt: string, now: Date = new Date()): number => Math.trunc((Date.parse(dueAt) - now.getTime()) / 60000);

/**
 * Order for one-glance triage: open first, then live calls (a rep is waiting in a call), then overdue/soonest due,
 * then oldest request.
 */
export function sortApprovals(items: readonly ApprovalCard[]): ApprovalCard[] {
  const due = (a: ApprovalCard) => (a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY);
  return [...items].sort(
    (a, b) =>
      Number(isOpen(b)) - Number(isOpen(a)) ||
      Number(b.mode === "live") - Number(a.mode === "live") ||
      due(a) - due(b) ||
      Date.parse(a.created_at) - Date.parse(b.created_at),
  );
}

/** Suggested counter: half-way between the policy limit and the request, rounded down to 0.5, always below the request. */
export function suggestedCounter(a: Pick<ApprovalCard, "requested_pct" | "policy_limit_pct">): number | null {
  const req = a.requested_pct;
  if (typeof req !== "number" || req <= 0) return null;
  const floor = typeof a.policy_limit_pct === "number" && a.policy_limit_pct < req ? a.policy_limit_pct : 0;
  let v = Math.floor(((floor + req) / 2) * 2) / 2;
  if (v >= req) v = req - 0.5;
  return v > 0 ? v : null;
}

export type CounterProblem = "required" | "not_positive" | "not_below_request";

/**
 * Client-side check of a counter % (REQ-DSC-004: below the requested %). The approver's own limit is enforced by
 * fn:approval-decide (validation_failed), since the card does not carry it.
 */
export function validateCounter(pct: number | null | undefined, a: Pick<ApprovalCard, "requested_pct">): CounterProblem | null {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "required";
  if (pct <= 0) return "not_positive";
  if (typeof a.requested_pct === "number" && pct >= a.requested_pct) return "not_below_request";
  return null;
}

/** The fn:approval-decide body for one tap from the app. */
export function decideRequest(
  a: Pick<ApprovalCard, "approval_id">,
  decision: Decision,
  opts: { pct?: number | null; note?: string | null } = {},
): FunctionRequestMap["approval-decide"] {
  const body: FunctionRequestMap["approval-decide"] = { approval_id: a.approval_id, decision, via: "app" };
  if (decision === "counter") body.approved_pct = opts.pct ?? null;
  const note = opts.note?.trim();
  if (note) body.note = note;
  return body;
}

const STATUS_FOR: Record<Decision, ApprovalCard["status"]> = { approve: "approved", counter: "countered", reject: "rejected" };

/**
 * The card to show after a decision. The function's returned card wins when it is the same approval; otherwise
 * (e.g. a sampled mock reply) the local card is patched with what was decided, so the screen never shows a stale state.
 */
export function afterDecision(local: ApprovalCard, decision: Decision, returned: ApprovalCard | undefined, pct?: number | null): ApprovalCard {
  if (returned && returned.approval_id === local.approval_id) return returned;
  return {
    ...local,
    status: STATUS_FOR[decision],
    approved_pct: decision === "approve" ? (local.requested_pct ?? null) : decision === "counter" ? (pct ?? null) : null,
  };
}

/** Insert or replace by approval_id (a live approval.created event or a decided card). */
export function upsert(items: readonly ApprovalCard[], card: ApprovalCard): ApprovalCard[] {
  const i = items.findIndex((x) => x.approval_id === card.approval_id);
  if (i < 0) return [card, ...items];
  const out = [...items];
  out[i] = card;
  return out;
}

/** The list the screen shows for a filter: "pending" hides what is no longer decidable. */
export const visible = (items: readonly ApprovalCard[], filter: ListFilter): ApprovalCard[] =>
  sortApprovals(filter === "pending" ? items.filter(isOpen) : items);

/** "8%" / "6.5%" with the screen's language decimal separator. */
export const pct = (v: number | null | undefined, lang: "el" | "en"): string =>
  typeof v === "number" ? `${new Intl.NumberFormat(lang === "el" ? "el-GR" : "en-GB", { maximumFractionDigits: 1 }).format(v)}%` : "–";
