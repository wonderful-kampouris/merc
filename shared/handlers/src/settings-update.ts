// fn:settings-update (contracts/functions/settings-update.json, REQ-SET-001, REQ-CORE-010): admin edits of the org
// settings, AI permissions per role x action, alert rules, ICP and discount policies. Partial: only the listed rows
// change, matched by natural key (ai_permission role+action, alert_rule alert type, icp_criterion criterion,
// discount_policy id, else its role/user/category combination). icp.category_ids, when given, replaces the target
// category set. Writes exactly one audit_event (settings_change, or permission_change when only AI permissions change).
// Also exports writeAudit, the one audit writer every WP-SET-01 admin function uses (rule B, REQ-CORE-004).
import { defineFunction, invalid, type Db, type Impl, type UserPrincipal } from "../../core/src/index";

export type AuditAction = "contact_export" | "contact_erase" | "settings_change" | "bulk_transfer" | "target_change" | "permission_change" | "user_change";

/** REQ-CORE-010: one audit row per human admin action. detail is JSON, never contact PII. */
export async function writeAudit(db: Db, me: UserPrincipal, action: AuditAction, target: { table?: string | null; id?: string | null }, detail: unknown, now: () => number = Date.now) {
  return db.audit_event.insert({
    actor_id: me.id, action, target_table: target.table ?? null, target_id: target.id ?? null,
    detail: detail == null ? null : JSON.stringify(detail).slice(0, 8000), occurred_at: new Date(now()).toISOString(),
  } as any);
}

/** Organization columns an admin may edit (not id, not the workspace binding). */
export const ORG_EDITABLE = [
  "name", "default_language", "timezone", "currency", "plan", "briefing_time", "approval_expiry_hours", "approval_sla_minutes",
  "manager_call_enabled", "recording_retention_days", "icp_min_score", "visits_per_day", "lost_after_multiplier", "baseline_start", "go_live_date",
] as const;
const MODES = ["auto", "ask", "never"];
const pick = (o: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const str = (v: unknown, what: string): string => { if (typeof v !== "string" || !v.trim()) throw invalid(`${what} is required`); return v.trim(); };

type Changes = Record<string, number>;

async function updateOrg(db: Db, me: UserPrincipal, patch: Record<string, unknown> | null | undefined, ch: Changes) {
  if (!patch) return;
  const unknown = Object.keys(patch).filter((k) => !(ORG_EDITABLE as readonly string[]).includes(k));
  if (unknown.length) throw invalid(`organization fields not editable: ${unknown.join(", ")}`, { fields: unknown });
  if (patch.briefing_time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(patch.briefing_time))) throw invalid("organization.briefing_time must be HH:MM");
  const p = pick(patch, ORG_EDITABLE);
  if (Object.keys(p).length) { await db.organization.update(me.org_id, p as any); ch.organization = Object.keys(p).length; }
}

async function upsertPermissions(db: Db, items: Array<Record<string, unknown>>, ch: Changes) {
  for (const it of items) {
    const role_code = str(it.role_code, "ai_permissions[].role_code"), action_type_code = str(it.action_type_code, "ai_permissions[].action_type_code");
    if (!MODES.includes(String(it.mode))) throw invalid(`ai_permissions[].mode must be one of ${MODES.join(", ")}`, { role_code, action_type_code });
    const mode = String(it.mode) as "auto" | "ask" | "never";
    const cur = await db.ai_permission.findOne({ role_code, action_type_code });
    if (cur) { if (cur.mode !== mode) await db.ai_permission.update(cur.id, { mode }); }
    else await db.ai_permission.insert({ role_code, action_type_code, mode } as any);
  }
  if (items.length) ch.ai_permissions = items.length;
}

async function upsertAlertRules(db: Db, items: Array<Record<string, unknown>>, ch: Changes) {
  for (const it of items) {
    const alert_type_code = str(it.alert_type_code, "alert_rules[].alert_type_code");
    const patch = pick(it, ["threshold_value", "window_days", "enabled"]);
    const cur = await db.alert_rule.findOne({ alert_type_code });
    if (cur) await db.alert_rule.update(cur.id, patch as any);
    else await db.alert_rule.insert({ alert_type_code, threshold_value: null, window_days: null, enabled: true, ...patch } as any);
  }
  if (items.length) ch.alert_rules = items.length;
}

async function updateIcp(db: Db, me: UserPrincipal, icp: Record<string, unknown> | null | undefined, ch: Changes) {
  if (!icp) return;
  if (icp.min_score !== undefined) { await db.organization.update(me.org_id, { icp_min_score: icp.min_score as any }); ch.icp_min_score = 1; }
  const criteria = (icp.criteria ?? []) as Array<Record<string, unknown>>;
  for (const c of criteria) {
    const criterion = str(c.criterion, "icp.criteria[].criterion");
    if (typeof c.weight !== "number") throw invalid("icp.criteria[].weight must be a number", { criterion });
    const cur = await db.icp_criterion.findOne({ criterion: criterion as any });
    if (cur) await db.icp_criterion.update(cur.id, { weight: c.weight });
    else await db.icp_criterion.insert({ criterion, weight: c.weight } as any);
  }
  if (criteria.length) ch.icp_criteria = criteria.length;
  if (Array.isArray(icp.category_ids)) {
    const want = new Set(icp.category_ids.map(String));
    const cur = await db.icp_category.all();
    for (const r of cur) if (!want.has(r.category_id)) await db.icp_category.delete(r.id);
    const have = new Set(cur.map((r) => r.category_id));
    for (const id of want) {
      if (have.has(id)) continue;
      if (!(await db.account_category.get(id))) throw invalid("icp.category_ids has an unknown account category", { category_id: id });
      await db.icp_category.insert({ category_id: id } as any);
    }
    ch.icp_categories = want.size;
  }
}

const POLICY_KEY = ["role_code", "user_id", "product_category_id", "account_category_id"] as const;
async function upsertPolicies(db: Db, items: Array<Record<string, unknown>>, ch: Changes) {
  for (const it of items) {
    const patch = pick(it, [...POLICY_KEY, "max_discount_pct", "valid_from", "valid_to", "active"]);
    let cur = typeof it.id === "string" ? await db.discount_policy.get(it.id) : null;
    if (typeof it.id === "string" && !cur) throw invalid("discount_policies[].id not found", { id: it.id });
    if (!cur) {
      const all = await db.discount_policy.all();
      cur = all.find((p: any) => POLICY_KEY.every((k) => (p[k] ?? null) === ((it as any)[k] ?? null))) ?? null;
    }
    if (cur) await db.discount_policy.update(cur.id, patch as any);
    else {
      if (typeof it.max_discount_pct !== "number") throw invalid("discount_policies[].max_discount_pct is required for a new policy");
      await db.discount_policy.insert({ role_code: null, user_id: null, product_category_id: null, account_category_id: null, active: true, ...patch } as any);
    }
  }
  if (items.length) ch.discount_policies = items.length;
}

export function makeImpl(now: () => number = Date.now): Impl<"settings-update"> {
  return async ({ req, db, me }) => {
    const ch: Changes = {};
    await updateOrg(db, me, req.organization as any, ch);
    await upsertPermissions(db, req.ai_permissions as any, ch);
    await upsertAlertRules(db, req.alert_rules as any, ch);
    await updateIcp(db, me, req.icp as any, ch);
    await upsertPolicies(db, req.discount_policies as any, ch);
    const sections = Object.keys(ch);
    if (!sections.length) return { updated: false };
    const action: AuditAction = sections.length === 1 && sections[0] === "ai_permissions" ? "permission_change" : "settings_change";
    await writeAudit(db, me, action, { table: "organization", id: me.org_id }, { changes: ch, request: req }, now);
    return { updated: true };
  };
}

export const impl = makeImpl();
/** Wonderful Function entry (functions/settings-update/index.ts calls this). */
export const handle = defineFunction("settings-update", impl);
