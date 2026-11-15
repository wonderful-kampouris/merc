// fn:manager-approvals-list (contracts/functions/manager-approvals-list.json, REQ-DSC-009, REQ-DSC-006 inbox).
// The approver's discount approvals as ApprovalCards. status: null -> open (pending + escalated), "all", or one status.
import { defineFunction, invalid, isAdmin, type Impl } from "../../core/src/index";
import { approvalCard } from "./discount-request";

const STATUSES = ["pending", "approved", "countered", "sent", "failed", "rejected", "expired", "escalated"] as const;
type Status = (typeof STATUSES)[number];

export const impl: Impl<"manager-approvals-list"> = async ({ req, db, me }) => {
  const s = req.status ?? null;
  if (s !== null && s !== "all" && !STATUSES.includes(s as Status)) throw invalid(`status must be one of all, ${STATUSES.join(", ")}`, { status: s });
  const statuses: Status[] | null = s === null ? ["pending", "escalated"] : s === "all" ? null : [s as Status];
  const orgUsers = new Set((await db.app_user.all()).map((u) => u.id));
  const rows = (await db.approval.all({ kind: "discount", ...(isAdmin(me) ? {} : { approver_id: me.id }), ...(statuses ? { status: statuses } : {}) }))
    .filter((a) => orgUsers.has(a.requested_by));
  const open = (x: { status: string }) => x.status === "pending" || x.status === "escalated";
  rows.sort((a, b) => Number(open(b)) - Number(open(a)) || (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999") || Number(b.created_at ?? 0) - Number(a.created_at ?? 0));
  const items = [];
  for (const a of rows.slice(0, 100)) items.push(await approvalCard(db, a));
  return { items };
};
export const handle = defineFunction("manager-approvals-list", impl);
