// fn:problem-update (contracts/functions/problem-update.json, REQ-CORE-009): move a problem of a visible account
// between open, in_progress and resolved; resolved_at is set when it becomes resolved and cleared when reopened.
import { defineFunction, requireAccountRow, type Impl, type Row } from "../../core/src/index";

export const impl: Impl<"problem-update"> = async ({ req, db, me }) => {
  const problem = await requireAccountRow(db, me, "problem", req.problem_id);
  const patch: Partial<Row<"problem">> = { status: req.status };
  if (req.due_date !== undefined) patch.due_date = req.due_date;
  if (req.status === "resolved") { if (problem.status !== "resolved") patch.resolved_at = new Date().toISOString(); }
  else if (problem.resolved_at) patch.resolved_at = null;
  await db.problem.update(problem.id, patch);
  return { problem_id: problem.id };
};

/** Wonderful Function entry (functions/problem-update/index.ts calls this). */
export const handle = defineFunction("problem-update", impl);
