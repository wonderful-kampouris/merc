import type { ActionLine, FunctionRequestMap } from "../../../contracts";

export type LogFilter = "all" | "applied" | "undone";
export const PAGE_SIZE = 20;
export const getActionId = (a: ActionLine): string => a.ai_action_id;

/** One growing page keeps a refetch (poll, retry) consistent with what is on screen. */
export const listRequest = (f: LogFilter, limit: number): FunctionRequestMap["ai-actions-list"] => ({ status: f === "all" ? null : f, page: 1, limit });

/** Undo is offered for applied, undoable actions (REQ-APP-004, REQ-CORE-006). */
export const canUndo = (a: ActionLine): boolean => a.undoable && a.status === "applied";

export const CLASS_COLOR = { internal: "muted", draft: "blue", external: "orange", structural: "purple", destructive: "red" } as const;
export const STATUS_COLOR = { suggested: "blue", applied: "green", undone: "muted", rejected: "muted" } as const;

/** `deal_stage_update` -> `Deal stage update` (action types are open-ended engine keys). */
export function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : key;
}

export const getUndone = (a: ActionLine): ActionLine => ({ ...a, status: "undone", undoable: false });
