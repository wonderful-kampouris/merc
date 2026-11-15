// fn:visit-plan-get (contracts/functions/visit-plan-get.json, REQ-PLN-002): one rep's week, Mon-Fri (+ weekend days
// that hold visits), with every visit as a VisitSummary. Scope owner_or_team: a rep reads their own week, a
// manager their team's, an admin anyone's. Also hosts the small VisitSummary/week helpers the other plan
// handlers import (no barrel: they import "./visit-plan-get").
import {
  addDays, assertOwnerOrTeam, defineFunction, startOfWeek, today,
  type Db, type FunctionResponseMap, type Impl, type Principal, type Row,
} from "../../core/src/index";

export type VisitSummary = FunctionResponseMap["visit-plan-get"]["days"][number]["visits"][number];
export interface Clock { now?: () => number }

/** Mon..Fri of the week that contains `date`. */
export const workWeek = (weekStart: string): string[] => [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i));

/** VisitSummary rows for visits, with their accounts and postal areas loaded in one pass each. */
export async function visitSummaries(db: Db, visits: Row<"visit">[]): Promise<VisitSummary[]> {
  if (!visits.length) return [];
  const accIds = [...new Set(visits.map((v) => v.account_id))];
  const accounts = new Map((await db.account.all({ id: accIds })).map((a) => [a.id, a]));
  const codes = [...new Set([...accounts.values()].map((a) => a.postal_code).filter((c): c is string => !!c))];
  const areas = new Map(codes.length ? (await db.postal_area.all({ postal_code: codes })).map((p) => [p.postal_code, p]) : []);
  return visits.map((v) => {
    const a = accounts.get(v.account_id);
    const pa = a?.postal_code ? areas.get(a.postal_code) : undefined;
    return {
      visit_id: v.id,
      account: {
        id: v.account_id,
        name: a?.name ?? "(unknown account)",
        account_type: (a?.account_type ?? "customer") as "prospect" | "customer" | "lost",
        postal_code: a?.postal_code ?? null,
        city: pa?.city ?? null,
        distance_m: null,
        reason: null,
      },
      planned_date: v.planned_date,
      route_position: typeof v.route_position === "number" ? Math.round(v.route_position) : null,
      status: v.status as VisitSummary["status"],
      purpose: v.purpose ?? null,
      // Planner visits carry their reason in purpose; a skipped visit shows why it was skipped.
      reason: v.status === "skipped" ? v.skip_reason ?? null : v.origin === "plan" ? v.purpose ?? null : null,
      lat: a?.lat ?? pa?.lat ?? null,
      lng: a?.lng ?? pa?.lng ?? null,
    };
  });
}
export const visitSummary = async (db: Db, v: Row<"visit">): Promise<VisitSummary> => (await visitSummaries(db, [v]))[0]!;

/** Route order inside a day: route_position first (nulls last), then account id for a stable order. */
export const byRoute = (a: Row<"visit">, b: Row<"visit">) =>
  (a.route_position ?? Infinity) - (b.route_position ?? Infinity) || a.account_id.localeCompare(b.account_id) || a.id.localeCompare(b.id);

/** A rep's visits on one day that still take a slot (planned or done; skipped ones free their slot). */
export async function dayVisits(db: Db, repId: string, date: string): Promise<Row<"visit">[]> {
  return (await db.visit.all({ rep_id: repId, planned_date: date, status: ["planned", "done"] })).sort(byRoute);
}

/** The visits_per_day cap warning (REQ-PLN-003), or null while the day is within the cap. */
export function capWarning(p: Principal, date: string, count: number): string | null {
  const cap = p.org.visits_per_day;
  return count > cap ? `${date} now has ${count} visits, above the daily cap of ${cap}` : null;
}

export function makeImpl(clock: Clock = {}): Impl<"visit-plan-get"> {
  return async ({ req, db, me }) => {
    const repId = req.rep_id ?? me.id;
    assertOwnerOrTeam(me, repId, "plan");
    const weekStart = startOfWeek(req.week_start ?? today(me.org, (clock.now ?? Date.now)()));
    const plan = await db.visit_plan.findOne({ rep_id: repId, week_start: weekStart });
    const weekEnd = addDays(weekStart, 6);
    const visits = (await db.visit.all({ rep_id: repId, planned_date: { op: "gte", value: weekStart } }, { and: [{ column: "planned_date", operator: "lte", value: weekEnd }] }))
      .sort((a, b) => a.planned_date.localeCompare(b.planned_date) || byRoute(a, b));
    const summaries = await visitSummaries(db, visits);
    const dates = [...new Set([...workWeek(weekStart), ...visits.map((v) => v.planned_date)])].sort();
    return {
      plan_id: plan?.id ?? null,
      week_start: weekStart,
      status: plan?.status ?? "none",
      days: dates.map((date) => ({ date, visits: summaries.filter((s) => s.planned_date === date) })),
    };
  };
}

export const impl = makeImpl();
/** Wonderful Function entry (functions/visit-plan-get/index.ts calls this). */
export const handle = defineFunction("visit-plan-get", impl);
