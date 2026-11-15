// fn:ai-actions-list (contracts/functions/ai-actions-list.json, REQ-CORE-005): the AI actions the caller may see,
// newest first, as ActionLines (with undoable and the approval id). Scope owner_or_team: a rep sees actions done
// on their behalf, a manager their team's and their own, an admin the whole org. `user_id` narrows inside the scope.
import { assertOwnerOrTeam, defineFunction, invalid, visibleUserIds, type Impl, type Row } from "../../core/src/index";
import { lineOf, type ActionClass } from "../../autonomy/src/index";
import { msOf } from "./approvals-list";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
const STATUSES = ["suggested", "applied", "undone", "rejected"] as const;

export const impl: Impl<"ai-actions-list"> = async ({ req, db, me }) => {
  const page = Math.max(1, Math.floor(req.page ?? 1));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(req.limit ?? DEFAULT_LIMIT)));
  if (req.status && !(STATUSES as readonly string[]).includes(req.status)) throw invalid(`status must be one of ${STATUSES.join(", ")}`, { status: req.status });
  if (req.user_id) assertOwnerOrTeam(me, req.user_id, "user");
  const users = req.user_id ? [req.user_id] : visibleUserIds(me);
  const where: Record<string, unknown> = {};
  if (users) where.on_behalf_of = users;
  if (req.voice_log_id) where.voice_log_id = req.voice_log_id;
  if (req.status) where.status = req.status;

  const from = req.from ? Date.parse(req.from) : -Infinity, to = req.to ? Date.parse(req.to) : Infinity;
  if (from > to) throw invalid("from must not be after to", { from: req.from, to: req.to });
  const rows = (await db.ai_action.all(where as never, { orderBy: [{ column: "created_at", direction: "desc" }] }))
    .filter((a) => { const t = msOf(a.created_at); return t >= from && t <= to; })
    .sort((x, y) => msOf(y.created_at) - msOf(x.created_at) || y.id.localeCompare(x.id));

  const slice = rows.slice((page - 1) * limit, page * limit);
  const classes = new Map((await db.action_type.all()).map((t) => [t.code, t.action_class as ActionClass]));
  const approvals = slice.length ? await db.approval.all({ ai_action_id: slice.map((a) => a.id) }) : [];
  const approvalOf = new Map(approvals.map((p: Row<"approval">) => [p.ai_action_id!, p.id]));
  return {
    items: slice.map((a) => lineOf(a, classes.get(a.action_type_code) ?? "internal", approvalOf.get(a.id) ?? null)),
    page: { page, limit, total: rows.length },
  };
};

/** Wonderful Function entry (functions/ai-actions-list/index.ts calls this). */
export const handle = defineFunction("ai-actions-list", impl);
