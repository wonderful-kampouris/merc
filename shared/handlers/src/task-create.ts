// fn:task-create (contracts/functions/task-create.json): a task/reminder owned by the caller.
// Optional account/deal links are scope-checked (REQ-CORE-009); a deal fills in its account.
// ai_action_id is always null here: tasks created through this function are the user's own (source "human").
// AI-proposed tasks are written by the debrief engine through shared/autonomy (WP-CORE-03), not here.
import { defineFunction, invalid, requireAccount, requireAccountRow, type Impl } from "../../core/src/index";

export const MAX_TITLE = 200;

export function cleanTitle(title: string): string {
  const t = title.trim();
  if (!t) throw invalid("title must not be empty");
  if (t.length > MAX_TITLE) throw invalid(`title must be at most ${MAX_TITLE} characters`);
  return t;
}

export const impl: Impl<"task-create"> = async ({ req, db, me }) => {
  const title = cleanTitle(req.title);
  let account_id = req.account_id ?? null;
  if (req.deal_id) {
    const deal = await requireAccountRow(db, me, "deal", req.deal_id);
    if (account_id && account_id !== deal.account_id) throw invalid("deal belongs to another account", { deal_id: deal.id, account_id });
    account_id = deal.account_id;
  } else if (account_id) {
    await requireAccount(db, me, account_id);
  }
  const task = await db.task.insert({
    owner_id: me.id,
    account_id,
    deal_id: req.deal_id ?? null,
    title,
    due_at: req.due_at ?? null,
    is_customer_promise: req.is_customer_promise ?? false,
    status: "open",
    source: "human",
  });
  return { task_id: task.id, ai_action_id: null };
};

export const handle = defineFunction("task-create", impl);
