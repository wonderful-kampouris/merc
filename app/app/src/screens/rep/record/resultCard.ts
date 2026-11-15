import type { FunctionResponseMap } from "../../../contracts";

export type ResultCard = FunctionResponseMap["debrief-result-get"];
export type ActionLine = ResultCard["lines"][number];

/** A line can be undone from the card when the engine says so and it is still applied (REQ-DEB-003). */
export const canUndo = (l: ActionLine): boolean => l.undoable && l.status === "applied";

/** Mark one line undone after fn:ai-action-undo succeeded. */
export function applyUndo(card: ResultCard, aiActionId: string): ResultCard {
  return { ...card, lines: card.lines.map((l) => (l.ai_action_id === aiActionId ? { ...l, status: "undone" as const, undoable: false } : l)) };
}

const CLASS_ORDER: Record<ActionLine["action_class"], number> = { internal: 0, draft: 1, external: 2, structural: 3, destructive: 4 };
const STATUS_ORDER: Record<ActionLine["status"], number> = { applied: 0, suggested: 1, undone: 2, rejected: 3 };

/** Applied first, then suggested; inside a status, internal before drafts and external actions. Stable. */
export function sortLines(lines: readonly ActionLine[]): ActionLine[] {
  return lines
    .map((l, i) => ({ l, i }))
    .sort((a, b) => STATUS_ORDER[a.l.status] - STATUS_ORDER[b.l.status] || CLASS_ORDER[a.l.action_class] - CLASS_ORDER[b.l.action_class] || a.i - b.i)
    .map((x) => x.l);
}

export type BadgeColor = "neutral" | "muted" | "blue" | "green" | "orange" | "red" | "teal" | "purple";
export const STATUS_COLOR: Record<ActionLine["status"], BadgeColor> = { applied: "green", suggested: "blue", undone: "muted", rejected: "red" };

/** Seconds with one decimal, for the "ready in 8.4 s" hint (REQ-NFR-001 budget is 25 s to visible). */
export const seconds = (ms: number): string => (Math.round(ms / 100) / 10).toFixed(1);

/** Card counts for the header. */
export function cardCounts(card: ResultCard): { applied: number; questions: number; approvals: number } {
  return {
    applied: card.lines.filter((l) => l.status === "applied").length,
    questions: card.missing_fields.length,
    approvals: card.pending_approvals.filter((a) => a.status === "pending").length,
  };
}
