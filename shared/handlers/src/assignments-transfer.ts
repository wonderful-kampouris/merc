// fn:assignments-transfer (contracts/functions/assignments-transfer.json, REQ-SET-003, REQ-CORE-010): move accounts
// from one rep to another. For each account owned by from_rep: owner_rep_id -> to_rep, an account_assignment_history
// row, the account's open tasks owned by from_rep -> to_rep, and its planned visits of from_rep from today on (org
// timezone) -> to_rep (detached from the old rep's weekly plan). Customer memory is keyed by account.id, so it
// follows automatically. all_accounts=true takes every account from_rep owns (account_ids may then be empty).
// Admin: any reps of the org. Manager: both reps in their team. One audit_event bulk_transfer. moved = accounts moved.
import { defineFunction, forbidden, inTeam, invalid, isAdmin, today, type Db, type Impl, type UserPrincipal } from "../../core/src/index";
import { writeAudit } from "./settings-update";

async function requireRep(db: Db, me: UserPrincipal, id: string, what: string, mustBeActive: boolean) {
  const u = await db.app_user.get(id);
  if (!u) throw invalid(`${what} is not a user of this organization`, { user_id: id });
  if (mustBeActive && u.status !== "active") throw invalid(`${what} ${u.full_name} is not active`, { user_id: id });
  if (!isAdmin(me) && !inTeam(me, id) && id !== me.id) throw forbidden(`${what} is outside your team`, { user_id: id });
  return u;
}

export function makeImpl(now: () => number = Date.now): Impl<"assignments-transfer"> {
  return async ({ req, db, me }) => {
    if (req.from_rep_id === req.to_rep_id) throw invalid("from_rep_id and to_rep_id are the same");
    const from = await requireRep(db, me, req.from_rep_id, "from rep", false);
    const to = await requireRep(db, me, req.to_rep_id, "to rep", true);

    const wanted = req.all_accounts ? null : [...new Set(req.account_ids)];
    if (wanted && !wanted.length) throw invalid("give account_ids or all_accounts=true");
    const accounts = await db.account.all(wanted ? { id: wanted, owner_rep_id: from.id } : { owner_rep_id: from.id });
    if (wanted) {
      const missing = wanted.filter((id) => !accounts.some((a) => a.id === id));
      if (missing.length) throw invalid(`${missing.length} account(s) are not owned by ${from.full_name}`, { account_ids: missing });
    }

    const at = new Date(now()).toISOString();
    const day = today(me.org, now());
    let tasks = 0, visits = 0;
    for (const a of accounts) {
      await db.account.update(a.id, { owner_rep_id: to.id });
      await db.account_assignment_history.insert({ account_id: a.id, from_rep_id: from.id, to_rep_id: to.id, transferred_by: me.id, transferred_at: at, reason: req.reason?.trim() || null } as any);
      for (const t of await db.task.all({ account_id: a.id, owner_id: from.id, status: "open" })) { await db.task.update(t.id, { owner_id: to.id }); tasks++; }
      for (const v of await db.visit.all({ account_id: a.id, rep_id: from.id, status: "planned", planned_date: { op: "gte", value: day } })) {
        await db.visit.update(v.id, { rep_id: to.id, plan_id: null, route_position: null } as any); visits++;
      }
    }
    await writeAudit(db, me, "bulk_transfer", { table: "account", id: accounts.length === 1 ? accounts[0].id : null },
      { from_rep_id: from.id, to_rep_id: to.id, account_ids: accounts.map((a) => a.id), all_accounts: !!req.all_accounts, tasks_moved: tasks, visits_moved: visits, reason: req.reason ?? null }, now);
    return { moved: accounts.length };
  };
}

export const impl = makeImpl();
/** Wonderful Function entry (functions/assignments-transfer/index.ts calls this). */
export const handle = defineFunction("assignments-transfer", impl);
