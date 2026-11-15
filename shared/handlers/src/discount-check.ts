// fn:discount-check (contracts/functions/discount-check.json, REQ-DSC-001) + the discount rules shared by the
// other WP-DSC-01 handlers (discount-request, approver-brief, approval-decide, manager-call-outcome, sla watch).
// Limits follow contracts/metrics.md#discount-limit exactly; no number here ever comes from an LLM.
import {
  defineCron, defineFunction, forbidden, globalString, invalid, requireAccount, today, withinLocalHours,
  type Db, type FunctionContext, type FunctionSlug, type Impl, type PlatformLike, type Principal, type Row, type UserPrincipal,
} from "../../core/src/index";
import type { ApiLike, Logger } from "../../live/src/index";

// ---- platform access ---------------------------------------------------------------------------
/** What the discount handlers need beyond tables: context.api (present only with a service account) and a clock. */
export interface DiscountDeps { api?: ApiLike | null; now?: () => number; log?: Logger }
export const nowOf = (d: DiscountDeps) => (d.now ? d.now() : Date.now());
export const isoAt = (ms: number) => new Date(ms).toISOString();

/** Global variable with the E.164 caller id attached to merc-approver on an outbound trunk (S7). */
export const GLOBAL_APPROVER_CALLER_ID = "MERC_APPROVER_CALLER_ID";
export const OUTBOUND_PATH = "/v1/agents/outbound";
export const CALL_HOURS = { start: "08:00", end: "20:00" } as const; // REQ-APV-003, org timezone
export const NO_ANSWER_AFTER_MS = 90_000; // REQ-DSC-006: no outcome within 90 s counts as no answer
export const ANSWER_TIMEOUT_S = 25;

const apiOf = (context: unknown): ApiLike | null => {
  const a = (context as { api?: ApiLike } | null)?.api;
  return a && typeof a.post === "function" ? a : null;
};
/** Function entry whose impl needs context.api: same runner as defineFunction (validation, identity, gate). */
export function defineWithApi<S extends FunctionSlug>(slug: S, make: (deps: DiscountDeps) => Impl<S, UserPrincipal>) {
  return (context: FunctionContext) => defineFunction(slug, make({ api: apiOf(context) }))(context);
}
/** Cron entry (once per org, system principal) whose impl needs context.api. */
export function defineCronWithApi<S extends FunctionSlug>(slug: S, make: (deps: DiscountDeps) => Impl<S, Principal>) {
  return (context: FunctionContext) => defineCron(slug, make({ api: apiOf(context) }))(context);
}

// ---- refs ----------------------------------------------------------------------------------------
export type RoleCode = "rep" | "manager" | "admin";
export const userRef = (u: Row<"app_user">) => ({ id: u.id, full_name: u.full_name, role: u.role_code as RoleCode });
export const accountRef = (a: Row<"account">) => ({ id: a.id, name: a.name, account_type: a.account_type, postal_code: a.postal_code ?? null });
export const firstName = (u: { full_name: string }) => u.full_name.split(/\s+/)[0] ?? u.full_name;
/** "8" / "6.5" for speech and previews. */
export const pct = (n: number) => `${Number.isInteger(n) ? n : Number(n.toFixed(2))}%`;

// ---- metrics.md#discount-limit -----------------------------------------------------------------------
export interface LineLimit { product_id: string; category_id: string | null; limit_pct: number; policy_id: string | null; rule: 1 | 2 | 3 | 4 | null }
export interface Limit { limit_pct: number; policy_id: string | null; lines: LineLimit[] }

const activeOn = (p: Row<"discount_policy">, day: string) => p.active && (!p.valid_from || p.valid_from <= day) && (!p.valid_to || p.valid_to >= day);

/** Resolve one line against the policies (pure; most specific first). */
export function lineLimit(policies: Row<"discount_policy">[], user: { id: string; role_code: string }, productCategory: string | null, accountCategory: string | null): Omit<LineLimit, "product_id" | "category_id"> {
  const pick = (rule: 1 | 2 | 3 | 4, f: (p: Row<"discount_policy">) => boolean) => {
    const p = policies.filter(f).sort((a, b) => a.id.localeCompare(b.id))[0];
    return p ? { limit_pct: p.max_discount_pct, policy_id: p.id, rule } : null;
  };
  const byRole = (p: Row<"discount_policy">) => !p.user_id && p.role_code === user.role_code;
  return pick(1, (p) => p.user_id === user.id)
    ?? (productCategory && accountCategory ? pick(2, (p) => byRole(p) && p.product_category_id === productCategory && p.account_category_id === accountCategory) : null)
    ?? (productCategory ? pick(3, (p) => byRole(p) && p.product_category_id === productCategory && !p.account_category_id) : null)
    ?? pick(4, (p) => byRole(p) && !p.product_category_id && !p.account_category_id)
    ?? { limit_pct: 0, policy_id: null, rule: null };
}

/** Request limit = min over the lines (the strictest line wins). */
export async function resolveLimit(db: Db, org: Row<"organization">, user: Row<"app_user">, account: Row<"account">, productIds: string[], now: number): Promise<Limit> {
  const ids = [...new Set(productIds)];
  if (!ids.length) throw invalid("at least one product is needed to resolve a discount limit");
  const day = today(org, now);
  const policies = (await db.discount_policy.all({ active: true })).filter((p) => activeOn(p, day));
  const products = await db.product.all({ id: ids });
  const missing = ids.filter((id) => !products.some((p) => p.id === id));
  if (missing.length) throw invalid("unknown product(s)", { product_ids: missing });
  const lines = ids.map((id) => {
    const p = products.find((x) => x.id === id)!;
    return { product_id: id, category_id: p.category_id ?? null, ...lineLimit(policies, user, p.category_id ?? null, account.category_id ?? null) };
  });
  const strict = lines.reduce((a, b) => (b.limit_pct < a.limit_pct ? b : a));
  return { limit_pct: strict.limit_pct, policy_id: strict.policy_id, lines };
}

export function checkPct(v: number, what = "discount_pct"): void {
  if (!Number.isFinite(v) || v <= 0 || v > 100) throw invalid(`${what} must be above 0 and at most 100`, { [what]: v });
}

// ---- approver -------------------------------------------------------------------------------------
/**
 * Who approves `pct` for `requester`: the first active manager/admin up the manager chain whose own limit covers
 * it; if nobody in the chain does, the nearest active one in the chain; else an active admin. Never the requester.
 */
export async function pickApprover(db: Db, org: Row<"organization">, requester: Row<"app_user">, account: Row<"account">, productIds: string[], requestedPct: number, now: number): Promise<{ approver: Row<"app_user">; limit_pct: number }> {
  const chain: Row<"app_user">[] = [];
  const seen = new Set([requester.id]);
  let cur: Row<"app_user"> | null = requester;
  for (let i = 0; cur?.manager_id && i < 10; i++) {
    if (seen.has(cur.manager_id)) break;
    seen.add(cur.manager_id);
    cur = await db.app_user.get(cur.manager_id);
    if (cur && cur.status === "active" && (cur.role_code === "manager" || cur.role_code === "admin")) chain.push(cur);
  }
  for (const u of chain) {
    const l = await resolveLimit(db, org, u, account, productIds, now);
    if (l.limit_pct >= requestedPct) return { approver: u, limit_pct: l.limit_pct };
  }
  const fallback = chain[0] ?? (await db.app_user.all({ role_code: "admin", status: "active" })).filter((u) => u.id !== requester.id).sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!fallback) throw forbidden("no approver available for this request (no active manager or admin)");
  return { approver: fallback, limit_pct: (await resolveLimit(db, org, fallback, account, productIds, now)).limit_pct };
}

// ---- live-call availability (REQ-DSC-002 / REQ-DSC-006 / REQ-APV-003) ------------------------------------
export type CallBlock = "manager_call_disabled" | "outside_call_hours" | "no_caller_id" | "no_service_account" | "approver_has_no_phone";
export const CALL_BLOCK_TEXT: Record<CallBlock, string> = {
  manager_call_disabled: "organization.manager_call_enabled is false",
  outside_call_hours: `outside call hours ${CALL_HOURS.start}-${CALL_HOURS.end} org time`,
  no_caller_id: `no caller id for merc-approver (global variable ${GLOBAL_APPROVER_CALLER_ID} is not set)`,
  no_service_account: "no service account on this function (context.api unavailable)",
  approver_has_no_phone: "the approver has no valid phone number",
};
export const E164 = /^\+[1-9]\d{6,14}$/;
/** Why a live call cannot start now, or null when it can. */
export function callBlock(org: Row<"organization">, approver: Row<"app_user">, platform: PlatformLike, deps: DiscountDeps): CallBlock | null {
  if (!org.manager_call_enabled) return "manager_call_disabled";
  if (!withinLocalHours(org, CALL_HOURS.start, CALL_HOURS.end, nowOf(deps))) return "outside_call_hours";
  const from = globalString(platform, GLOBAL_APPROVER_CALLER_ID);
  if (!from || !E164.test(from)) return "no_caller_id";
  if (!deps.api) return "no_service_account";
  if (!approver.phone || !E164.test(approver.phone)) return "approver_has_no_phone";
  return null;
}

// ---- fn:discount-check -----------------------------------------------------------------------------
export function makeImpl(deps: DiscountDeps = {}): Impl<"discount-check"> {
  return async ({ req, db, me, platform }) => {
    checkPct(req.discount_pct);
    const now = nowOf(deps);
    const account = await requireAccount(db, me, req.account_id);
    const limit = await resolveLimit(db, me.org, me.user, account, req.product_ids, now);
    const allowed = req.discount_pct <= limit.limit_pct;
    if (allowed) {
      const action = await db.ai_action.insert({
        org_id: me.org_id, on_behalf_of: me.id, agent: "discount", action_type_code: "discount_within_limit",
        target_table: "account", target_id: account.id, status: "applied", applied_at: isoAt(now),
        reason: `${pct(req.discount_pct)} is within the limit of ${pct(limit.limit_pct)}`,
        payload_json: JSON.stringify({ discount_pct: req.discount_pct, limit_pct: limit.limit_pct, policy_id: limit.policy_id, product_ids: req.product_ids }),
      });
      return { allowed, limit_pct: limit.limit_pct, policy_id: limit.policy_id, approver: null, manager_call_available: false, ai_action_id: action.id };
    }
    const { approver } = await pickApprover(db, me.org, me.user, account, req.product_ids, req.discount_pct, now);
    return { allowed, limit_pct: limit.limit_pct, policy_id: limit.policy_id, approver: userRef(approver), manager_call_available: callBlock(me.org, approver, platform, deps) === null, ai_action_id: null };
  };
}
export const impl = makeImpl();
export const handle = defineWithApi("discount-check", makeImpl);
