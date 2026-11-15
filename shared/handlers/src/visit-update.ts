// fn:visit-update (contracts/functions/visit-update.json, REQ-PLN-003): move, skip, add, reorder or complete one
// of the caller's visits. Every move/skip/add/reorder writes a visit_change with the reason and the source
// (via "app" from the Rep App, "buddy" from the voice tool). A day above organization.visits_per_day still
// saves but returns a warning. Scope owner: only the visit's rep (or an admin).
//   app entry:   handle            (impl,      via "app")
//   buddy tool:  runAsTool("visit-update", buddyImpl, ...)   (via "buddy")
// move/skip may name the account instead of the visit ("Move Lofos to Friday"): the next planned visit of the
// caller to that account (today or later) is used.
import {
  assertOwner, defineFunction, invalid, notFound, requireAccount, startOfWeek, today,
  type Db, type FunctionRequestMap, type Impl, type Principal, type Row,
} from "../../core/src/index";
import { byRoute, capWarning, dayVisits, visitSummary, type Clock } from "./visit-plan-get";

export type Via = "app" | "buddy";
type Req = FunctionRequestMap["visit-update"];

async function targetVisit(db: Db, me: Principal, req: Req, todayDate: string): Promise<Row<"visit">> {
  if (req.visit_id) {
    const v = await db.visit.require(req.visit_id);
    assertOwner(me, v.rep_id, "visit");
    return v;
  }
  if (!req.account_id) throw invalid(`${req.action} needs visit_id or account_id`);
  const account = await requireAccount(db, me, req.account_id);
  const next = (await db.visit.all({ rep_id: me.id, account_id: account.id, status: "planned", planned_date: { op: "gte", value: todayDate } }))
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date) || byRoute(a, b))[0];
  if (!next) throw notFound(`no planned visit to ${account.name} from ${todayDate} on`, { account_id: account.id });
  return next;
}

/** Put `visit` at 1-based `position` in its day (null = last) and renumber the day 1..n. Returns the visit row. */
async function placeInDay(db: Db, visit: Row<"visit">, position: number | null | undefined): Promise<Row<"visit">> {
  const others = (await dayVisits(db, visit.rep_id, visit.planned_date)).filter((v) => v.id !== visit.id);
  const at = position == null ? others.length : Math.min(Math.max(position, 1), others.length + 1) - 1;
  const order = [...others.slice(0, at), visit, ...others.slice(at)];
  let self = visit;
  for (const [i, v] of order.entries()) {
    if (v.route_position === i + 1) continue;
    const saved = await db.visit.update(v.id, { route_position: i + 1 });
    if (v.id === visit.id) self = saved;
  }
  return self;
}

export function makeImpl(via: Via = "app", clock: Clock = {}): Impl<"visit-update"> {
  return async ({ req, db, me }) => {
    const nowMs = (clock.now ?? Date.now)();
    const todayDate = today(me.org, nowMs);
    const reason = req.reason?.trim() || null;
    const changed = (visit: Row<"visit">, change_type: "moved" | "skipped" | "added" | "reordered", from: string | null, to: string | null) =>
      db.visit_change.insert({ visit_id: visit.id, changed_by: me.id, change_type, from_date: from, to_date: to, reason, via } as any);
    const futureDate = (d: string | null | undefined): string => {
      if (!d) throw invalid(`${req.action} needs date`);
      if (d < todayDate) throw invalid(`${d} is in the past (today is ${todayDate})`);
      return d;
    };

    let visit: Row<"visit">;
    switch (req.action) {
      case "add": {
        if (!req.account_id) throw invalid("add needs account_id and date");
        const date = futureDate(req.date);
        const account = await requireAccount(db, me, req.account_id);
        if (account.account_type === "lost") throw invalid(`${account.name} is a lost account`);
        if ((await dayVisits(db, me.id, date)).some((v) => v.account_id === account.id && v.status === "planned")) throw invalid(`${account.name} is already planned for ${date}`);
        const plan = await db.visit_plan.findOne({ rep_id: me.id, week_start: startOfWeek(date) });
        visit = await db.visit.insert({
          account_id: account.id, rep_id: me.id, plan_id: plan?.id ?? null, origin: via === "buddy" ? "buddy" : "manual",
          planned_date: date, route_position: null, status: "planned", purpose: reason,
        } as any);
        visit = await placeInDay(db, visit, req.position);
        await changed(visit, "added", null, date);
        break;
      }
      case "move": {
        visit = await targetVisit(db, me, req, todayDate);
        if (visit.status !== "planned") throw invalid(`only a planned visit can be moved (this one is ${visit.status})`);
        const date = futureDate(req.date);
        const from = visit.planned_date;
        if (date === from) throw invalid(`the visit is already on ${date}; use reorder to change its position`);
        visit = await db.visit.update(visit.id, { planned_date: date, route_position: null });
        await placeInDay(db, { ...visit, planned_date: from }, undefined).catch(() => undefined); // renumber the old day (visit itself left it)
        visit = await placeInDay(db, visit, req.position);
        await changed(visit, "moved", from, date);
        break;
      }
      case "skip": {
        visit = await targetVisit(db, me, req, todayDate);
        if (visit.status !== "planned") throw invalid(`only a planned visit can be skipped (this one is ${visit.status})`);
        visit = await db.visit.update(visit.id, { status: "skipped", skip_reason: reason, route_position: null });
        await changed(visit, "skipped", visit.planned_date, null);
        break;
      }
      case "reorder": {
        visit = await targetVisit(db, me, req, todayDate);
        if (visit.status !== "planned") throw invalid(`only a planned visit can be reordered (this one is ${visit.status})`);
        if (req.position == null || req.position < 1) throw invalid("reorder needs position (1 = first stop)");
        visit = await placeInDay(db, visit, req.position);
        await changed(visit, "reordered", visit.planned_date, visit.planned_date);
        break;
      }
      case "done": {
        visit = await targetVisit(db, me, req, todayDate);
        if (visit.status === "skipped") throw invalid("a skipped visit cannot be marked done");
        if (visit.status !== "done") visit = await db.visit.update(visit.id, { status: "done", completed_at: new Date(nowMs).toISOString(), ...(reason ? { outcome: reason } : {}) });
        break;
      }
    }
    const dayCount = (await dayVisits(db, visit.rep_id, visit.planned_date)).length;
    return { visit: await visitSummary(db, visit), day_count: dayCount, warning: capWarning(me, visit.planned_date, dayCount) };
  };
}

/** App entry impl (via "app"). */
export const impl = makeImpl("app");
/** Buddy tool impl (via "buddy"): agents/merc-buddy tools/update_visit runs runAsTool("visit-update", buddyImpl, ...). */
export const buddyImpl = makeImpl("buddy");
/** Wonderful Function entry (functions/visit-update/index.ts calls this). */
export const handle = defineFunction("visit-update", impl);
