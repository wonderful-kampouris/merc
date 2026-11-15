import type { FunctionRequestMap, FunctionResponseMap, VisitSummary } from "../../../contracts";
import type { Overrides } from "../approvals/kit/overrides";

export type Plan = FunctionResponseMap["visit-plan-get"];
export type PlanDay = Plan["days"][number];

export const PLAN_STATUS = ["proposed", "accepted", "edited"] as const;
export const isKnownPlanStatus = (s: string): s is (typeof PLAN_STATUS)[number] => (PLAN_STATUS as readonly string[]).includes(s);
export const PLAN_COLOR = { proposed: "orange", accepted: "green", edited: "blue" } as const;
export const PURPOSES = ["routine", "prospect", "follow_up", "problem", "campaign", "assigned"] as const;
export const isKnownPurpose = (s: string): s is (typeof PURPOSES)[number] => (PURPOSES as readonly string[]).includes(s);

/** A plan exists and is not accepted yet (REQ-PLN-002). */
export const canAccept = (p: Plan): boolean => !!p.plan_id && p.status !== "accepted";
export const canChange = (v: VisitSummary): boolean => v.status === "planned";
export const countVisits = (p: Plan): number => p.days.reduce((n, d) => n + d.visits.filter((v) => v.status !== "skipped").length, 0);

const byPosition = (a: VisitSummary, b: VisitSummary) => (a.route_position ?? 1e9) - (b.route_position ?? 1e9);

/**
 * The plan with the results of visit-update applied: a moved visit leaves its day and joins the day of its new
 * planned_date (when that day is in this week); each day is in route order. Overrides whose server row changed drop.
 */
export function getMergedPlan(plan: Plan, map: Overrides<VisitSummary>): Plan {
  const dates = new Set(plan.days.map((d) => d.date));
  const moved = new Map<string, VisitSummary[]>();
  const days = plan.days.map((d) => {
    const visits: VisitSummary[] = [];
    for (const v of d.visits) {
      const o = map.get(v.visit_id);
      const cur = o && o.before === JSON.stringify(v) ? o.after : v;
      const target = cur !== v && cur.planned_date !== d.date ? cur.planned_date : null;
      if (target === null) visits.push(cur);
      else if (dates.has(target)) moved.set(target, [...(moved.get(target) ?? []), cur]);
    }
    return { ...d, visits };
  });
  return { ...plan, days: days.map((d) => ({ ...d, visits: [...d.visits, ...(moved.get(d.date) ?? [])].sort(byPosition) })) };
}

type UpdateBody = FunctionRequestMap["visit-update"];
const reasonOrNull = (r: string): string | null => (r.trim() ? r.trim() : null);

export const createMoveBody = (v: VisitSummary, date: string, reason: string): UpdateBody => ({ visit_id: v.visit_id, action: "move", date, reason: reasonOrNull(reason) });
export const createSkipBody = (v: VisitSummary, reason: string): UpdateBody => ({ visit_id: v.visit_id, action: "skip", reason: reasonOrNull(reason) });

/** 1-based route position one step earlier or later within the day; null when already first / last. */
export function createReorderBody(day: PlanDay, v: VisitSummary, dir: -1 | 1): UpdateBody | null {
  const i = day.visits.findIndex((x) => x.visit_id === v.visit_id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= day.visits.length) return null;
  return { visit_id: v.visit_id, action: "reorder", date: day.date, position: j + 1 };
}

export interface EditState {
  visitId: string;
  mode: "move" | "skip";
  date: string;
  reason: string;
}
