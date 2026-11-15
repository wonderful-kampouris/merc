// fn:tasks-list (contracts/functions/tasks-list.json, scope owner_or_team): a rep sees their own tasks,
// a manager their own plus the team's, an admin every user of the org. Ordered by due_at (soonest first).
// due_before is exclusive. Items: tbl:task columns plus account/owner names and an `overdue` flag.
import { assertOwnerOrTeam, defineFunction, notFound, visibleUserIds, type Impl, type Where } from "../../core/src/index";
import { byId, paging } from "./deals-list";

export const impl: Impl<"tasks-list"> = async ({ req, db, me }) => {
  const { page, limit, offset } = paging(req);
  let owners: string[];
  if (req.owner_id) {
    assertOwnerOrTeam(me, req.owner_id, "user");
    if (!(await db.app_user.get(req.owner_id))) throw notFound("user not found", { owner_id: req.owner_id });
    owners = [req.owner_id];
  } else {
    // task has no org_id: an admin's "everyone" is bounded by the org's users.
    owners = visibleUserIds(me) ?? (await db.app_user.all()).map((u) => u.id);
  }
  const where: Where<"task"> = { owner_id: owners };
  if (req.status) where.status = req.status;
  const and = req.due_before ? [{ column: "due_at", operator: "lt" as const, value: req.due_before }] : [];
  const res = await db.task.list(where, { limit, offset, and, orderBy: [{ column: "due_at", direction: "asc" }, { column: "id", direction: "asc" }] });

  const accounts = await byId(db, "account", res.items.map((t) => t.account_id));
  const users = await byId(db, "app_user", res.items.map((t) => t.owner_id));
  const now = Date.now();
  const items = res.items.map((t) => ({
    id: t.id,
    task_id: t.id,
    title: t.title,
    status: t.status,
    source: t.source,
    is_customer_promise: t.is_customer_promise,
    due_at: t.due_at ?? null,
    overdue: t.status === "open" && !!t.due_at && Date.parse(t.due_at) < now,
    account_id: t.account_id ?? null,
    account_name: (t.account_id && accounts.get(t.account_id)?.name) || null,
    deal_id: t.deal_id ?? null,
    owner_id: t.owner_id,
    owner_name: users.get(t.owner_id)?.full_name ?? null,
    voice_log_id: t.voice_log_id ?? null,
  }));
  return { items, page: { page, limit, total: res.total } };
};

export const handle = defineFunction("tasks-list", impl);
