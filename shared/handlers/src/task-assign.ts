// fn:task-assign (contracts/functions/task-assign.json, REQ-PLN-004): a manager gives one of their reps a task.
// Scope team: the rep must be in the caller's team (admin: anyone). An account, when given, must be visible to
// both the manager and the rep.
import { canSeeAccount, defineFunction, invalid, requireAccount, type Impl } from "../../core/src/index";
import { requireTeamRep } from "./visit-assign";

export const impl: Impl<"task-assign"> = async ({ req, db, me }) => {
  const rep = await requireTeamRep(db, me, req.rep_id);
  const title = req.title.trim();
  if (!title) throw invalid("title must not be empty");
  if (req.account_id) {
    const account = await requireAccount(db, me, req.account_id);
    if (!canSeeAccount(rep, account)) throw invalid(`${account.name} is outside ${rep.user.full_name}'s accounts`, { account_id: account.id, rep_id: rep.id });
  }
  const task = await db.task.insert({
    owner_id: rep.id,
    account_id: req.account_id ?? null,
    title,
    is_customer_promise: false,
    due_at: req.due_at ?? null,
    status: "open",
    source: "human",
  } as any);
  return { task_id: task.id };
};

/** Wonderful Function entry (functions/task-assign/index.ts calls this). */
export const handle = defineFunction("task-assign", impl);
