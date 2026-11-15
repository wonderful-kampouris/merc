// fn:task-update (contracts/functions/task-update.json, scope owner_or_team): status / due date / title.
// Null or missing fields are left unchanged (the contract has no "clear" semantics). A call with
// nothing to change is a no-op that still returns the task id.
import { assertOwnerOrTeam, defineFunction, type Impl, type TableRows } from "../../core/src/index";
import { cleanTitle } from "./task-create";

export const impl: Impl<"task-update"> = async ({ req, db, me }) => {
  const task = await db.task.require(req.task_id);
  assertOwnerOrTeam(me, task.owner_id, "task");
  const patch: Partial<TableRows["task"]> = {};
  if (req.status) patch.status = req.status;
  if (req.due_at) patch.due_at = req.due_at;
  if (typeof req.title === "string") patch.title = cleanTitle(req.title);
  if (Object.keys(patch).length) await db.task.update(task.id, patch);
  return { task_id: task.id };
};

export const handle = defineFunction("task-update", impl);
