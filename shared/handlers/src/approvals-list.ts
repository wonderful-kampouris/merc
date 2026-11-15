// fn:approvals-list (contracts/functions/approvals-list.json, REQ-APR-001): the caller's approvals as ApprovalCards.
// Also home of the shared approval helpers (loadApproval, approvalCard) used by approval-status / approval-resolve /
// message-send / approvals-expire, so the card shape and the org check live once (REQ-CORE-004).
// tbl:approval has no org_id: a row belongs to the org of its requester (app_user is org-scoped), so every load
// goes through the org-scoped db.app_user and an approval of another org reads as not_found.
import { assertRequesterOrApprover, defineFunction, isAdmin, notFound, type Db, type Impl, type Principal, type Row } from "../../core/src/index";
import type { ApprovalCard } from "../../core/src/generated/contracts/types";

export type ApprovalRow = Row<"approval">;
const PREVIEW_MAX = 160;

/** Platform created_at/updated_at (epoch s/ms or ISO) -> ISO instant. */
export function isoOf(v: unknown, fallback = 0): string {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(Date.parse(v)).toISOString();
  return new Date(fallback).toISOString();
}
export const msOf = (v: unknown): number => Date.parse(isoOf(v));

export function parseJson(s: string | null | undefined): Record<string, any> {
  if (!s) return {};
  try { const v = JSON.parse(s); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

/** Approval by id inside the caller's org (via its requester), or not_found. */
export async function loadApproval(db: Db, id: string): Promise<ApprovalRow> {
  const a = await db.approval.get(id);
  if (!a || !(await db.app_user.get(a.requested_by))) throw notFound("approval not found", { approval_id: id });
  return a;
}
/** loadApproval + requester_or_approver scope (REQ-CORE-009). */
export async function requireVisibleApproval(db: Db, me: Principal, id: string): Promise<ApprovalRow> {
  const a = await loadApproval(db, id);
  assertRequesterOrApprover(me, a);
  return a;
}

const firstLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n = PREVIEW_MAX) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Build the contract ApprovalCard for one approval (all reads org-scoped). */
export async function approvalCard(db: Db, a: ApprovalRow): Promise<ApprovalCard> {
  const [req, appr] = await Promise.all([db.app_user.get(a.requested_by), db.app_user.get(a.approver_id)]);
  if (!req || !appr) throw notFound("approval not found", { approval_id: a.id });
  const ref = (u: Row<"app_user">) => ({ id: u.id, full_name: u.full_name, role: u.role_code as "rep" | "manager" | "admin" });
  const card: ApprovalCard = {
    approval_id: a.id, kind: a.kind as ApprovalCard["kind"], status: a.status as ApprovalCard["status"], mode: a.mode as ApprovalCard["mode"],
    account: null, requested_by: ref(req), approver: ref(appr), preview: "",
    channel: null, recipient: null, subject: null, body: null,
    requested_pct: null, policy_limit_pct: null, approved_pct: null,
    decision_note: a.decision_note ?? null, due_at: a.due_at ?? null, expires_at: a.expires_at ?? null, created_at: isoOf(a.created_at),
  };
  let accountId: string | null = null;
  if (a.kind === "discount") {
    const d = await db.discount_request.findOne({ approval_id: a.id });
    if (d) {
      accountId = d.account_id;
      card.requested_pct = d.requested_pct; card.policy_limit_pct = d.policy_limit_pct; card.approved_pct = d.approved_pct ?? null;
    }
  } else {
    const m = await db.message_approval.findOne({ approval_id: a.id });
    if (m) {
      card.channel = m.channel_code; card.recipient = m.recipient_address; card.subject = m.subject ?? null;
      card.body = m.final_body ?? m.draft_body;
      if (m.contact_id) accountId = (await db.contact.get(m.contact_id))?.account_id ?? null;
    }
    if (!accountId && a.ai_action_id) {
      const act = await db.ai_action.get(a.ai_action_id);
      const p = parseJson(act?.payload_json);
      if (typeof p.account_id === "string") accountId = p.account_id;
      if (!card.body && a.kind === "conversion" && act?.reason) card.preview = clip(firstLine(act.reason));
    }
  }
  if (accountId) {
    const acc = await db.account.get(accountId);
    if (acc) card.account = { id: acc.id, name: acc.name, account_type: acc.account_type as "prospect" | "customer" | "lost", postal_code: acc.postal_code ?? null };
  }
  if (!card.preview) card.preview = clip(previewText(card));
  return card;
}

function previewText(c: ApprovalCard): string {
  const acc = c.account?.name ?? "";
  if (c.kind === "discount") return `${c.requested_pct ?? "?"}% discount${acc ? ` for ${acc}` : ""} (limit ${c.policy_limit_pct ?? "?"}%)`;
  if (c.kind === "customer_message") {
    const to = c.recipient ? `To ${c.recipient}: ` : "";
    return `${to}${firstLine(c.subject ? `${c.subject}. ${c.body ?? ""}` : c.body ?? "") || "(empty message)"}`;
  }
  if (c.kind === "conversion") return `Convert ${acc || "account"} to customer`;
  return `${c.kind} approval${acc ? ` for ${acc}` : ""}`;
}

/** Approvals visible to the caller (requester/approver; admin: the whole org), newest first. */
export async function listApprovals(db: Db, me: Principal, f: { kind?: string | null; status?: string | null; role?: "requester" | "approver" | null }): Promise<ApprovalRow[]> {
  const base: Record<string, unknown> = {};
  if (f.kind) base.kind = f.kind;
  if (f.status) base.status = f.status;
  const sets: Record<string, unknown>[] = [];
  if (f.role === "requester") sets.push({ ...base, requested_by: me.id });
  else if (f.role === "approver") sets.push({ ...base, approver_id: me.id });
  else if (isAdmin(me)) {
    const orgUsers = (await db.app_user.all()).map((u) => u.id);
    sets.push({ ...base, requested_by: orgUsers });
  } else sets.push({ ...base, requested_by: me.id }, { ...base, approver_id: me.id });
  const byId = new Map<string, ApprovalRow>();
  for (const w of sets) for (const a of await db.approval.all(w as never, { orderBy: [{ column: "created_at", direction: "desc" }], cap: 1000 })) byId.set(a.id, a);
  // Admin with a role filter or anyone: drop rows whose requester is outside this org.
  const rows: ApprovalRow[] = [];
  for (const a of byId.values()) if (await db.app_user.get(a.requested_by)) rows.push(a);
  return rows.sort((x, y) => msOf(y.created_at) - msOf(x.created_at) || x.id.localeCompare(y.id));
}

export const LIST_LIMIT = 100;
export const impl: Impl<"approvals-list"> = async ({ req, db, me }) => {
  const rows = (await listApprovals(db, me, req)).slice(0, LIST_LIMIT);
  const items: ApprovalCard[] = [];
  for (const a of rows) items.push(await approvalCard(db, a));
  return { items };
};

export const handle = defineFunction("approvals-list", impl);
