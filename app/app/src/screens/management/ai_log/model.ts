import type { FunctionRequestMap, FunctionResponseMap } from "../../../contracts";

export type ActionLine = FunctionResponseMap["ai-actions-list"]["items"][number];
export type ActionStatus = ActionLine["status"];
export type ActionClass = ActionLine["action_class"];
export const STATUSES: readonly ActionStatus[] = ["suggested", "applied", "undone", "rejected"];
export const CLASSES: readonly ActionClass[] = ["internal", "draft", "external", "structural", "destructive"];
export const PAGE_SIZE = 20;

export interface Filters {
  status: ActionStatus | "";
  from: string; // YYYY-MM-DD or ""
  to: string;
  page: number; // 1-based, as in the contract Page
}
export const defaultFilters = (): Filters => ({ status: "", from: "", to: "", page: 1 });

/** Filters -> ai-actions-list query. Dates are whole days in UTC; empty filters are left out. */
export function toQuery(f: Filters): FunctionRequestMap["ai-actions-list"] {
  const q: FunctionRequestMap["ai-actions-list"] = { page: f.page, limit: PAGE_SIZE };
  if (f.status) q.status = f.status;
  if (f.from) q.from = `${f.from}T00:00:00Z`;
  if (f.to) q.to = `${f.to}T23:59:59Z`;
  return q;
}

export const pageCount = (total: number, limit: number): number => Math.max(1, Math.ceil(total / Math.max(1, limit)));

export const STATUS_COLOR: Record<ActionStatus, "blue" | "green" | "muted" | "red"> = { suggested: "blue", applied: "green", undone: "muted", rejected: "red" };
export const CLASS_COLOR: Record<ActionClass, "neutral" | "teal" | "orange" | "purple" | "red"> = {
  internal: "neutral", draft: "teal", external: "orange", structural: "purple", destructive: "red",
};

/** Counts per status in the current page, for the summary chips. */
export function statusCounts(items: readonly ActionLine[]): Record<ActionStatus, number> {
  const out = { suggested: 0, applied: 0, undone: 0, rejected: 0 };
  for (const i of items) out[i.status]++;
  return out;
}
