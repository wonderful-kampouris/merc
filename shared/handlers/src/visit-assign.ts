// fn:visit-assign (contracts/functions/visit-assign.json, REQ-PLN-004): a manager puts a visit on a rep's day.
// Scope team. The visit is origin "manager", joins the rep's plan for that week when there is one, and logs a
// visit_change "assigned" via "manager". It then shows on the rep's Today screen (today-get reads visit by
// rep_id + planned_date). A second planned visit to the same account on the same day is a conflict.
import {
  assertTeam, canSeeAccount, conflict, defineFunction, forbidden, invalid, requireAccount, resolvePrincipal,
  startOfWeek, today, type Db, type Impl, type Principal, type UserPrincipal,
} from "../../core/src/index";
import { dayVisits, visitSummary, type Clock } from "./visit-plan-get";

/** The target rep as a principal, after checking they are in the caller's team and active. */
export async function requireTeamRep(db: Db, me: Principal, repId: string): Promise<UserPrincipal> {
  assertTeam(me, repId, "rep");
  let rep: UserPrincipal;
  try { rep = await resolvePrincipal(db.api, { kind: "app_user", appUserId: repId, orgId: me.org_id }); }
  catch { throw forbidden("rep is not an active Merc user of this organization", { rep_id: repId }); }
  return rep;
}

export function makeImpl(clock: Clock = {}): Impl<"visit-assign"> {
  return async ({ req, db, me }) => {
    const rep = await requireTeamRep(db, me, req.rep_id);
    const account = await requireAccount(db, me, req.account_id);
    if (!canSeeAccount(rep, account)) throw invalid(`${account.name} is outside ${rep.user.full_name}'s accounts`, { account_id: account.id, rep_id: rep.id });
    if (account.account_type === "lost") throw invalid(`${account.name} is a lost account`, { account_id: account.id });
    const now = today(me.org, (clock.now ?? Date.now)());
    if (req.date < now) throw invalid(`cannot assign a visit in the past (${req.date} is before ${now})`);
    const day = await dayVisits(db, rep.id, req.date);
    if (day.some((v) => v.account_id === account.id && v.status === "planned")) throw conflict(`${account.name} is already planned for ${req.date}`);
    const plan = await db.visit_plan.findOne({ rep_id: rep.id, week_start: startOfWeek(req.date) });
    // Append as the last stop: after the highest position, or after the day's count when positions are unset.
    const last = Math.max(day.length, day.reduce((m, v) => Math.max(m, v.route_position ?? 0), 0));
    const visit = await db.visit.insert({
      account_id: account.id, rep_id: rep.id, plan_id: plan?.id ?? null, origin: "manager", planned_date: req.date,
      route_position: last + 1, status: "planned", purpose: req.purpose?.trim() || null,
    } as any);
    await db.visit_change.insert({ visit_id: visit.id, changed_by: me.id, change_type: "assigned", from_date: null, to_date: req.date, reason: req.purpose?.trim() || null, via: "manager" } as any);
    return { visit: await visitSummary(db, visit) };
  };
}

export const impl = makeImpl();
/** Wonderful Function entry (functions/visit-assign/index.ts calls this). */
export const handle = defineFunction("visit-assign", impl);
