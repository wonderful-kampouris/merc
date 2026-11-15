import type { AlertCard, FunctionRequestMap } from "../../../contracts";

export type AlertFilter = "open" | "all";
export type AlertAction = FunctionRequestMap["alert-act"]["action"];

export const getAlertId = (a: AlertCard): string => a.alert_id;

export const KNOWN_TYPES = [
  "going_quiet",
  "deal_stuck",
  "close_date_passed",
  "promise_due",
  "competition_wave",
  "visit_overdue",
  "rep_not_logging",
  "approval_overdue",
] as const;
export const isKnownType = (t: string): t is (typeof KNOWN_TYPES)[number] => (KNOWN_TYPES as readonly string[]).includes(t);

export const SEVERITY_COLOR = { high: "red", medium: "orange", low: "muted" } as const;
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export const listRequest = (f: AlertFilter): FunctionRequestMap["alerts-list"] => (f === "open" ? { status: "open", limit: 50 } : { limit: 50 });

/** Open alerts only for the open filter; highest severity first, then newest. */
export function getVisible(items: readonly AlertCard[], f: AlertFilter): AlertCard[] {
  const list = f === "open" ? items.filter((a) => a.status === "open") : [...items];
  return list.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.created_at.localeCompare(a.created_at));
}

/** The suggested action as a button (REQ-ALR-002): a message draft for email-ish suggestions and deal/promise alerts, else a task. */
export function getPrimaryAction(a: AlertCard): Extract<AlertAction, "create_task" | "create_draft"> {
  if (a.type === "deal_stuck" || a.type === "promise_due") return "create_draft";
  return /e-?mail|draft|message|μήνυμα|email/i.test(a.suggested_action ?? "") ? "create_draft" : "create_task";
}

export const getSecondaryAction = (a: AlertCard): Extract<AlertAction, "create_task" | "create_draft"> =>
  getPrimaryAction(a) === "create_task" ? "create_draft" : "create_task";
