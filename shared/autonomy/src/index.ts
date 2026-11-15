// Merc autonomy engine (REQ-CORE-005 / REQ-CORE-006). Every AI write goes through propose():
//   mode = ai_permission(role, action_type) else action_type.default_mode; destructive is always `never`.
//   auto  -> apply() writes through a Writer (before/after rows captured) + ai_action "applied" with snapshots
//   ask   -> nothing written; ai_action "suggested" + approval "pending" for the approver
//   never -> nothing written; ai_action "suggested" (the card shows it as a suggestion)
// undo() puts the touched rows back to the before snapshot exactly and deletes rows the action created
// (the only delete path in Merc, internal/draft rows only). applySuggested() applies an approved suggestion.
import {
  TABLES, actorUserId, assertOwner, blocked, conflict, invalid,
  type Db, type Principal, type Row, type TableName,
} from "../../core/src/index";
import type { ActionLine } from "../../core/src/generated/contracts/types";
import { decode, encode, repo, restore, type SnapRow } from "./snapshot";

export * from "./snapshot";

export type Mode = "auto" | "ask" | "never";
export type ActionClass = ActionLine["action_class"];
export type Agent = Row<"ai_action">["agent"];
export type ApprovalKind = Row<"approval">["kind"];
export const UNDOABLE_CLASSES: readonly ActionClass[] = ["internal", "draft"];

export interface ModeInfo { mode: Mode; action_class: ActionClass; source: "ai_permission" | "default" | "destructive" }

/** The mode of one action type for a role (REQ-CORE-005). Unknown action types are a validation error. */
export async function resolveMode(db: Db, role: string, code: string): Promise<ModeInfo> {
  const at = await db.action_type.get(code);
  if (!at) throw invalid(`unknown action type ${code}`, { action_type: code });
  const action_class = at.action_class as ActionClass;
  if (action_class === "destructive") return { mode: "never", action_class, source: "destructive" };
  const perm = await db.ai_permission.findOne({ role_code: role as never, action_type_code: code });
  return perm ? { mode: perm.mode as Mode, action_class, source: "ai_permission" } : { mode: at.default_mode as Mode, action_class, source: "default" };
}

const pkOf = (t: TableName, row: Record<string, unknown>) => String(row[TABLES[t].pk]);
const plain = (r: object | null): Record<string, unknown> | null => (r ? { ...(r as Record<string, unknown>) } : null);

/** Insert/update helper handed to apply(): records the first before and the last after of every touched row. No delete. */
export class Writer {
  private readonly touched = new Map<string, { table: TableName; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>();
  constructor(private readonly db: Db) {}
  private note(table: TableName, id: string, before: Record<string, unknown> | null, after: Record<string, unknown>) {
    const k = `${table}:${id}`;
    const cur = this.touched.get(k);
    if (cur) cur.after = after; else this.touched.set(k, { table, id, before, after });
  }
  async insert<N extends TableName>(table: N, data: Record<string, unknown>): Promise<Row<N>> {
    const row = await repo(this.db, table).insert(data as never) as Row<N>;
    this.note(table, pkOf(table, row as unknown as Record<string, unknown>), null, plain(row)!);
    return row;
  }
  async update<N extends TableName>(table: N, id: string, patch: Record<string, unknown>): Promise<Row<N>> {
    const before = this.touched.has(`${table}:${id}`) ? null : plain(await repo(this.db, table).require(id));
    const row = await repo(this.db, table).update(id, patch as never) as Row<N>;
    this.note(table, id, before, plain(row)!);
    return row;
  }
  get before(): SnapRow[] { return [...this.touched.values()].map((x) => ({ table: x.table, id: x.id, row: x.before })); }
  get after(): SnapRow[] { return [...this.touched.values()].map((x) => ({ table: x.table, id: x.id, row: x.after })); }
}

export type Target = { table: string; id: string } | null;

export interface Proposal {
  /** action_type.code */
  code: string;
  agent: Agent;
  /** One line for the result card and ai_action.reason. */
  summary: string;
  payload?: unknown;
  voice_log_id?: string | null;
  /** Known target for ask/never (apply() returns it for auto). */
  target?: Target;
  /** The user the AI acts for; defaults to the caller. Required for system principals. */
  on_behalf_of?: string;
  /** Role whose ai_permission applies; defaults to the caller's role. */
  role?: string;
  /** The writes. Only called in auto mode (or later by applySuggested after approval). */
  apply: (w: Writer) => Promise<Target>;
  /** Approval for ask mode; approver defaults to the caller's manager, else the caller. */
  approval?: { kind?: ApprovalKind; approver_id?: string; mode?: "live" | "async"; due_at?: string | null; expires_at?: string | null };
}

export interface Outcome {
  mode: Mode;
  action_class: ActionClass;
  applied: boolean;
  ai_action: Row<"ai_action">;
  approval: Row<"approval"> | null;
  target: Target;
  line: ActionLine;
}

/** Approval kind per action type when the caller does not name one. */
const KIND: Record<string, ApprovalKind> = {
  send_email: "customer_message", send_whatsapp: "customer_message", send_viber: "customer_message", book_meeting: "customer_message",
  convert_prospect: "conversion", discount_within_limit: "discount",
};

export function lineOf(a: Row<"ai_action">, action_class: ActionClass, approval_id: string | null = null): ActionLine {
  return {
    ai_action_id: a.id, action_type: a.action_type_code, action_class, status: a.status, summary: a.reason ?? a.action_type_code,
    target_table: a.target_table ?? null, target_id: a.target_id ?? null,
    undoable: a.status === "applied" && UNDOABLE_CLASSES.includes(action_class) && !!decode(a.before_snapshot_json),
    approval_id,
  };
}

/** Run one AI action through its mode (REQ-CORE-005). */
export async function propose(db: Db, me: Principal, p: Proposal, opts: { now?: number } = {}): Promise<Outcome> {
  const onBehalfOf = p.on_behalf_of ?? actorUserId(me);
  if (!onBehalfOf) throw invalid("ai_action.on_behalf_of is required for system callers", { action_type: p.code });
  const info = await resolveMode(db, p.role ?? me.role, p.code);
  const at = new Date(opts.now ?? Date.now()).toISOString();
  const base = {
    on_behalf_of: onBehalfOf, agent: p.agent, action_type_code: p.code, voice_log_id: p.voice_log_id ?? null,
    reason: p.summary.slice(0, 500), payload_json: JSON.stringify(p.payload ?? null),
  };

  if (info.mode === "auto") {
    const w = new Writer(db);
    const target = (await p.apply(w)) ?? p.target ?? null;
    const ai = await db.ai_action.insert({
      ...base, target_table: target?.table ?? null, target_id: target?.id ?? null, status: "applied", applied_at: at,
      before_snapshot_json: encode(w.before), after_snapshot_json: encode(w.after),
    } as never);
    return { ...info, applied: true, ai_action: ai, approval: null, target, line: lineOf(ai, info.action_class) };
  }

  const target = p.target ?? null;
  const ai = await db.ai_action.insert({ ...base, target_table: target?.table ?? null, target_id: target?.id ?? null, status: "suggested" } as never);
  let approval: Row<"approval"> | null = null;
  if (info.mode === "ask") {
    const approver = p.approval?.approver_id ?? (me.kind === "user" ? me.manager?.id : null) ?? onBehalfOf;
    approval = await db.approval.insert({
      ai_action_id: ai.id, kind: p.approval?.kind ?? KIND[p.code] ?? "terms", requested_by: onBehalfOf, approver_id: approver,
      mode: p.approval?.mode ?? "async", status: "pending", due_at: p.approval?.due_at ?? null, expires_at: p.approval?.expires_at ?? null,
    } as never);
  }
  return { ...info, applied: false, ai_action: ai, approval, target, line: lineOf(ai, info.action_class, approval?.id ?? null) };
}

/** Apply a suggested action after its approval was granted (ask mode). Destructive or `never` stays blocked. */
export async function applySuggested(db: Db, aiActionId: string, apply: (w: Writer) => Promise<Target>, opts: { now?: number; role?: string } = {}): Promise<Row<"ai_action">> {
  const a = await db.ai_action.require(aiActionId);
  if (a.status !== "suggested") throw conflict(`ai action is ${a.status}, not suggested`, { ai_action_id: a.id, status: a.status });
  const owner = await db.app_user.require(a.on_behalf_of);
  const info = await resolveMode(db, opts.role ?? owner.role_code, a.action_type_code);
  if (info.mode === "never") throw blocked(`${a.action_type_code} is never applied by the AI`, { action_type: a.action_type_code, action_class: info.action_class });
  const approval = await db.approval.findOne({ ai_action_id: a.id });
  if (info.mode === "ask" && !(approval && ["approved", "sent"].includes(approval.status))) throw blocked("ai action needs an approved approval first", { ai_action_id: a.id });
  const w = new Writer(db);
  const target = (await apply(w)) ?? (a.target_table && a.target_id ? { table: a.target_table, id: a.target_id } : null);
  return db.ai_action.update(a.id, {
    status: "applied", applied_at: new Date(opts.now ?? Date.now()).toISOString(), target_table: target?.table ?? null, target_id: target?.id ?? null,
    before_snapshot_json: encode(w.before), after_snapshot_json: encode(w.after),
  } as never);
}

export interface UndoResult { ai_action_id: string; status: "undone"; restored: { table: string; id: string } }

/**
 * Undo an applied internal/draft action (REQ-CORE-006): rows go back to the before snapshot exactly, rows the
 * action created are deleted. A row changed since the action is a conflict and nothing is written.
 */
export async function undo(db: Db, me: Principal, aiActionId: string, opts: { now?: number } = {}): Promise<UndoResult> {
  const a = await db.ai_action.require(aiActionId);
  assertOwner(me, a.on_behalf_of, "ai action");
  if (a.status === "undone") throw conflict("ai action is already undone", { ai_action_id: a.id, status: a.status });
  if (a.status !== "applied") throw conflict(`ai action is ${a.status}; only applied actions can be undone`, { ai_action_id: a.id, status: a.status });
  const at = await db.action_type.get(a.action_type_code);
  const cls = (at?.action_class ?? "external") as ActionClass;
  if (!UNDOABLE_CLASSES.includes(cls)) throw blocked(`${cls} actions cannot be undone`, { ai_action_id: a.id, action_class: cls });
  const before = decode(a.before_snapshot_json);
  if (!before) throw conflict("ai action has no usable before snapshot", { ai_action_id: a.id });
  const after = decode(a.after_snapshot_json);
  await restore(db, before.rows, after?.rows ?? null);
  await db.ai_action.update(a.id, { status: "undone", undone_at: new Date(opts.now ?? Date.now()).toISOString(), undone_by: actorUserId(me) } as never);
  const first = before.rows[0];
  const restored = a.target_table && a.target_id ? { table: a.target_table, id: a.target_id } : first ? { table: first.table, id: first.id } : { table: "ai_action", id: a.id };
  return { ai_action_id: a.id, status: "undone", restored };
}
