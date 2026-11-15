// fn:account-lifecycle (contracts/functions/account-lifecycle.json, REQ-ALR-005). Cron "45 2 * * *".
// metrics.md #lost: a customer with no confirmed order for more than max(60, lost_after_multiplier x avg) days
// becomes `lost` through an ai_action mark_account_lost (internal, agent lifecycle) that the owner can undo.
// Uses tbl:account_metrics (built by metrics-rollup). The mode comes from ai_permission (owner's role) and falls
// back to action_type.default_mode: auto -> applied; ask/never -> stored as `suggested`, account untouched.
// An action the owner undid is not re-applied while the account's last order stays the same.
//
// WP-CORE-03 (shared/autonomy + fn:ai-action-undo) is not available, so the snapshot is written here in the
// format shared/autonomy/src/snapshot.ts defines ({v:1, rows:[{table,id,row}]}), and undoMarkAccountLost() below
// is the round-trip the undo engine must perform for this action type.
import { conflict, defineCron, forbidden, notFound, today, type Db, type FunctionContext, type Impl, type Principal, type Row } from "../../core/src/index";
import { cronData, inChunks } from "./metrics-rollup";

export const ACTION = "mark_account_lost";
export const MIN_LOST_DAYS = 60;
const SNAPSHOT_VERSION = 1;

/** metrics.md #lost limit in days. */
export const lostAfterDays = (avg: number, multiplier: number) => Math.max(MIN_LOST_DAYS, multiplier * avg);

const SYSTEM = new Set(["created_at", "updated_at"]);
function business(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row).sort()) if (!SYSTEM.has(k) && row[k] !== null && row[k] !== undefined) out[k] = row[k];
  return out;
}
const snapshot = (row: Row<"account">) => JSON.stringify({ v: SNAPSHOT_VERSION, rows: [{ table: "account", id: row.id, row: business(row as unknown as Record<string, unknown>) }] });

async function modeFor(db: Db, role: string): Promise<string> {
  const p = await db.ai_permission.findOne({ role_code: role, action_type_code: ACTION });
  if (p) return p.mode;
  return (await db.action_type.get(ACTION))?.default_mode ?? "ask";
}

export interface LifecycleDeps { now?: () => number }

export function makeImpl(deps: LifecycleDeps = {}): Impl<"account-lifecycle", Principal> {
  return async ({ req, db, me }) => {
    const now = (deps.now ?? Date.now)();
    const dry = req.dry_run === true;
    const day = today(me.org, now);
    const customers = await db.account.all({ account_type: "customer" }, { cap: 20_000 });
    const metrics = new Map((await inChunks(customers.map((a) => a.id), (c) => db.account_metrics.all({ account_id: c }, { cap: 50_000 }))).map((m) => [m.account_id, m]));
    const multiplier = me.org.lost_after_multiplier;
    const users = new Map((await db.app_user.all()).map((u) => [u.id, u]));
    const modes = new Map<string, string>();
    const marked: Array<{ account_id: string; name: string; days: number; limit: number; ai_action_id: string | null; status: string }> = [];
    const skipped: Array<{ account_id: string; reason: string }> = [];

    for (const a of customers) {
      const m = metrics.get(a.id);
      if (!m || m.days_since_last_order === null || m.days_since_last_order === undefined || m.avg_order_interval_days == null) continue;
      const limit = lostAfterDays(m.avg_order_interval_days, multiplier);
      if (!(m.days_since_last_order > limit)) continue;
      const owner = a.owner_rep_id ? users.get(a.owner_rep_id) : undefined;
      if (!owner) { skipped.push({ account_id: a.id, reason: "no owner (ai_action.on_behalf_of is required)" }); continue; }
      const prior = await db.ai_action.all({ action_type_code: ACTION, target_id: a.id });
      const sameGap = (x: Row<"ai_action">) => { try { return JSON.parse(x.payload_json ?? "{}").last_order_date === m.last_order_date; } catch { return false; } };
      if (prior.some((x) => sameGap(x) && (x.status === "undone" || x.status === "rejected" || x.status === "suggested"))) { skipped.push({ account_id: a.id, reason: "already handled for this order gap" }); continue; }
      if (!modes.has(owner.role_code)) modes.set(owner.role_code, await modeFor(db, owner.role_code));
      const mode = modes.get(owner.role_code)!;
      const status = mode === "auto" ? "applied" : "suggested";
      const days = m.days_since_last_order;
      const reason = `No confirmed order for ${days} days (lost after ${limit} days: max(${MIN_LOST_DAYS}, ${multiplier} x ${m.avg_order_interval_days}))`;
      if (dry) { marked.push({ account_id: a.id, name: a.name, days, limit, ai_action_id: null, status }); continue; }
      const after = status === "applied" ? await db.account.update(a.id, { account_type: "lost" }) : null;
      const action = await db.ai_action.insert({
        on_behalf_of: owner.id, agent: "lifecycle", action_type_code: ACTION, target_table: "account", target_id: a.id, status, reason,
        payload_json: JSON.stringify({ account_type: "lost", last_order_date: m.last_order_date, days_since_last_order: days, limit_days: limit, evaluated_on: day }),
        before_snapshot_json: snapshot(a), after_snapshot_json: after ? snapshot(after) : null,
        applied_at: after ? new Date(now).toISOString() : null,
      } as never);
      marked.push({ account_id: a.id, name: a.name, days, limit, ai_action_id: action.id, status });
    }
    return { processed: customers.length, created: marked.length, details: { dry_run: dry, today: day, marked, skipped } };
  };
}

export const impl = makeImpl();
export const handle = (context: FunctionContext & { params?: unknown }) => defineCron("account-lifecycle", impl)({ ...context, data: cronData(context) });

/**
 * The undo for mark_account_lost (what fn:ai-action-undo must do for this action): restore the account's
 * before-snapshot columns and mark the action undone. Only the owner (or an admin) may undo; an account changed
 * since the action (not `lost` any more) is a conflict.
 */
export async function undoMarkAccountLost(db: Db, me: Principal, aiActionId: string, now: number = Date.now()): Promise<{ ai_action_id: string; status: "undone"; restored: { table: string; id: string } }> {
  const action = await db.ai_action.require(aiActionId);
  if (action.action_type_code !== ACTION) throw notFound("not a mark_account_lost action", { ai_action_id: aiActionId });
  if (me.role !== "admin" && action.on_behalf_of !== me.id) throw forbidden("ai action is outside your scope");
  if (action.status !== "applied") throw conflict(`ai action is ${action.status}, not applied`);
  const snap = JSON.parse(action.before_snapshot_json ?? "null") as { v: number; rows: Array<{ table: string; id: string; row: Record<string, unknown> }> } | null;
  const before = snap?.v === SNAPSHOT_VERSION ? snap.rows.find((r) => r.table === "account") : undefined;
  if (!before) throw conflict("ai action has no usable before snapshot");
  const cur = await db.account.require(before.id);
  if (cur.account_type !== "lost") throw conflict("account changed since the action; not undoing");
  await db.account.update(before.id, { account_type: before.row.account_type as "customer" });
  await db.ai_action.update(action.id, { status: "undone", undone_at: new Date(now).toISOString(), undone_by: me.kind === "user" ? me.id : null });
  return { ai_action_id: action.id, status: "undone", restored: { table: "account", id: before.id } };
}
