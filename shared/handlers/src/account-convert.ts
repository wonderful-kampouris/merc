// fn:account-convert (contracts/functions/account-convert.json, REQ-APR-004): converting a prospect to a customer is a
// structural action. ai_permission (org, caller role, convert_prospect) decides:
//   ask (seed default) -> ai_action "suggested" + approval kind conversion "pending" for the approver; approval.created pushed
//   auto               -> applied now (account_type=customer, customer_since=today) with snapshots; approval recorded as approved
//   never              -> blocked_by_policy
// A second call while a conversion is pending returns the same approval (idempotent).
// WP-CORE-03 (shared/autonomy propose/apply) did not ship, so the propose step is done here with the same ai_action
// columns and the shared/autonomy snapshot format; approval-resolve applies payload_json.patch when approved.
import { blocked, defineFunction, invalid, requireAccount, today, type Db, type Impl, type Row, type UserPrincipal } from "../../core/src/index";
import { push, repChannel, type ApiLike } from "../../live/src/index";
import { encode } from "../../autonomy/src/snapshot";
import { accountRef, cityMap } from "./accounts-list";

export const ACTION_TYPE = "convert_prospect";
export interface ConvertDeps { api?: ApiLike | null; now?: () => number }

/** Mode from ai_permission for the caller's role, falling back to action_type.default_mode, then "ask". */
export async function conversionMode(db: Db, me: UserPrincipal): Promise<"auto" | "ask" | "never"> {
  const p = await db.ai_permission.findOne({ role_code: me.role, action_type_code: ACTION_TYPE });
  if (p) return p.mode;
  const t = await db.action_type.get(ACTION_TYPE);
  return (t?.default_mode as "auto" | "ask" | "never" | undefined) ?? "ask";
}

/** Approver of a conversion: the caller's active manager, else another active admin of the org, else the caller (admin). */
export async function conversionApprover(db: Db, me: UserPrincipal): Promise<Row<"app_user">> {
  if (me.manager && me.manager.status === "active") return me.manager;
  const admins = (await db.app_user.all({ role_code: "admin", status: "active" })).filter((u) => u.id !== me.id);
  return admins.sort((a, b) => a.full_name.localeCompare(b.full_name))[0] ?? me.user;
}

const userRef = (u: Row<"app_user">) => ({ id: u.id, full_name: u.full_name, role: u.role_code as "rep" | "manager" | "admin" });
const iso = (v: unknown, fallback: number) => (typeof v === "number" && v > 0 ? new Date(v) : new Date(fallback)).toISOString();

export function makeImpl(deps: ConvertDeps = {}): Impl<"account-convert"> {
  return async ({ req, db, me }) => {
    const now = deps.now?.() ?? Date.now();
    const account = await requireAccount(db, me, req.account_id);

    // Idempotent: a pending conversion of this account is returned as is.
    for (const a of await db.ai_action.all({ target_table: "account", target_id: account.id, action_type_code: ACTION_TYPE, status: "suggested" })) {
      const ap = await db.approval.findOne({ ai_action_id: a.id });
      if (ap && ap.status === "pending") return { approval_id: ap.id, status: ap.status };
    }
    if (account.account_type !== "prospect") throw invalid(`${account.name} is a ${account.account_type}, only prospects can be converted`, { account_type: account.account_type });

    const mode = await conversionMode(db, me);
    if (mode === "never") throw blocked("converting prospects is disabled for your role (ai_permission convert_prospect = never)", { action_type: ACTION_TYPE, role: me.role });

    const patch = { account_type: "customer" as const, customer_since: today(me.org, now) };
    const before = encode([{ table: "account", id: account.id, row: { ...account } }]);
    const base = {
      on_behalf_of: me.id, agent: "lifecycle" as const, action_type_code: ACTION_TYPE, target_table: "account", target_id: account.id,
      reason: `convert ${account.name} from prospect to customer`, payload_json: JSON.stringify({ table: "account", id: account.id, patch }), before_snapshot_json: before,
    };
    const approver = await conversionApprover(db, me);
    const at = new Date(now).toISOString();

    if (mode === "auto") {
      const updated = await db.account.update(account.id, patch);
      const action = await db.ai_action.insert({ ...base, status: "applied", applied_at: at, after_snapshot_json: encode([{ table: "account", id: account.id, row: { ...updated } }]) });
      const ap = await db.approval.insert({ ai_action_id: action.id, kind: "conversion", requested_by: me.id, approver_id: me.id, mode: "async", status: "approved", decided_by: me.id, decided_at: at, decided_via: "app", decision_note: "auto by ai_permission" });
      return { approval_id: ap.id, status: ap.status };
    }

    const action = await db.ai_action.insert({ ...base, status: "suggested" });
    const ap = await db.approval.insert({ ai_action_id: action.id, kind: "conversion", requested_by: me.id, approver_id: approver.id, mode: "async", status: "pending" });
    const areas = await cityMap(db, [account.postal_code]);
    await push({ api: deps.api ?? null }, "approval.created", {
      approval: {
        approval_id: ap.id, kind: "conversion", status: "pending", mode: "async", account: accountRef(account, areas),
        requested_by: userRef(me.user), approver: userRef(approver), preview: `Convert ${account.name} from prospect to customer`,
        due_at: null, expires_at: null, created_at: iso(ap.created_at, now),
      },
    }, repChannel(approver.id));
    return { approval_id: ap.id, status: ap.status };
  };
}

export const impl = makeImpl();

/** Wonderful Function entry: context.api (service account) is passed through so approval.created can be pushed. */
export const handle = (context: Parameters<ReturnType<typeof defineFunction>>[0] & { api?: ApiLike | null }) =>
  defineFunction("account-convert", makeImpl({ api: context.api ?? null }))(context);
