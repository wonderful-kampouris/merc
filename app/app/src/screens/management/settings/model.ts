import type { FunctionRequestMap, FunctionResponseMap } from "../../../contracts";
import { bool, isObj, num, objArr, optStr, str, type Obj } from "./kit";

export type Mode = "auto" | "ask" | "never";
export const MODES: readonly Mode[] = ["auto", "ask", "never"];
export const ROLES = ["rep", "manager", "admin"] as const;

export interface Permission {
  role_code: string;
  action_type_code: string;
  mode: Mode;
}
export interface AlertRule {
  alert_type_code: string;
  threshold_value: number | null;
  window_days: number | null;
  enabled: boolean;
}
export interface DiscountPolicy {
  id: string | null;
  role_code: string | null;
  user_id: string | null;
  product_category_id: string | null;
  account_category_id: string | null;
  max_discount_pct: number;
  active: boolean;
}
export interface Settings {
  organization: Obj;
  ai_permissions: Permission[];
  alert_rules: AlertRule[];
  icp: Obj;
  discount_policies: DiscountPolicy[];
}

const asMode = (s: string): Mode | null => (MODES.includes(s as Mode) ? (s as Mode) : null);

export function parseSettings(r: FunctionResponseMap["settings-get"]): Settings {
  return {
    organization: isObj(r.organization) ? r.organization : {},
    ai_permissions: objArr(r.ai_permissions)
      .filter((o) => str(o, "role_code") && str(o, "action_type_code") && asMode(str(o, "mode")))
      .map((o) => ({ role_code: str(o, "role_code"), action_type_code: str(o, "action_type_code"), mode: asMode(str(o, "mode"))! })),
    alert_rules: objArr(r.alert_rules)
      .filter((o) => str(o, "alert_type_code"))
      .map((o) => ({ alert_type_code: str(o, "alert_type_code"), threshold_value: num(o, "threshold_value"), window_days: num(o, "window_days"), enabled: bool(o, "enabled", true) })),
    icp: isObj(r.icp) ? r.icp : {},
    discount_policies: objArr(r.discount_policies)
      .filter((o) => num(o, "max_discount_pct") !== null)
      .map((o) => ({
        id: optStr(o, "id"),
        role_code: optStr(o, "role_code"),
        user_id: optStr(o, "user_id"),
        product_category_id: optStr(o, "product_category_id"),
        account_category_id: optStr(o, "account_category_id"),
        max_discount_pct: num(o, "max_discount_pct")!,
        active: bool(o, "active", true),
      })),
  };
}

/** Organization fields an admin edits here, in display order. Others (ids, plan, dates) are read-only. */
export const ORG_FIELDS = [
  "name", "default_language", "timezone", "currency", "briefing_time", "visits_per_day", "approval_expiry_hours",
  "approval_sla_minutes", "manager_call_enabled", "recording_retention_days", "icp_min_score", "lost_after_multiplier",
] as const;
export type OrgField = (typeof ORG_FIELDS)[number];
export const orgFieldsPresent = (org: Obj): OrgField[] => ORG_FIELDS.filter((k) => k in org);

/** Role x action matrix: action codes in first-seen order, and a lookup. */
export function permissionMatrix(perms: readonly Permission[]) {
  const actions: string[] = [];
  for (const p of perms) if (!actions.includes(p.action_type_code)) actions.push(p.action_type_code);
  const roles = ROLES.filter((r) => perms.some((p) => p.role_code === r));
  const mode = (role: string, action: string): Mode | null => perms.find((p) => p.role_code === role && p.action_type_code === action)?.mode ?? null;
  return { actions, roles, mode };
}

export function setMode(perms: readonly Permission[], role: string, action: string, mode: Mode): Permission[] {
  const i = perms.findIndex((p) => p.role_code === role && p.action_type_code === action);
  if (i < 0) return [...perms, { role_code: role, action_type_code: action, mode }];
  return perms.map((p, j) => (j === i ? { ...p, mode } : p));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const policyKey = (p: DiscountPolicy) => p.id ?? [p.role_code, p.user_id, p.product_category_id, p.account_category_id].join("|");

/**
 * settings-update body with only what changed (contract: partial update, arrays replace only the listed rows
 * matched by natural key). Unchanged organization/icp are sent as null.
 */
export function diffSettings(before: Settings, after: Settings): FunctionRequestMap["settings-update"] {
  const org: Obj = {};
  for (const [k, v] of Object.entries(after.organization)) if (!same(before.organization[k], v)) org[k] = v;
  const perms = after.ai_permissions.filter(
    (p) => before.ai_permissions.find((q) => q.role_code === p.role_code && q.action_type_code === p.action_type_code)?.mode !== p.mode,
  );
  const rules = after.alert_rules.filter((r) => !same(before.alert_rules.find((q) => q.alert_type_code === r.alert_type_code), r));
  const pols = after.discount_policies.filter((p) => !same(before.discount_policies.find((q) => policyKey(q) === policyKey(p)), p));
  return {
    organization: Object.keys(org).length ? org : null,
    ai_permissions: perms as unknown as Obj[],
    alert_rules: rules as unknown as Obj[],
    icp: same(before.icp, after.icp) ? null : after.icp,
    discount_policies: pols as unknown as Obj[],
  };
}

export function changeCount(d: FunctionRequestMap["settings-update"]): number {
  return (d.organization ? Object.keys(d.organization).length : 0) + d.ai_permissions.length + d.alert_rules.length + d.discount_policies.length + (d.icp ? 1 : 0);
}

/** ICP weights: `icp.criteria` as `[{criterion, weight}]` (icp_criterion rows) when present. */
export interface IcpCriterion {
  criterion: string;
  weight: number;
}
export function icpCriteria(icp: Obj): IcpCriterion[] {
  return objArr(icp.criteria)
    .filter((o) => str(o, "criterion") && num(o, "weight") !== null)
    .map((o) => ({ criterion: str(o, "criterion"), weight: num(o, "weight")! }));
}
export function setIcpWeight(icp: Obj, criterion: string, weight: number): Obj {
  const criteria = objArr(icp.criteria).map((o) => (str(o, "criterion") === criterion ? { ...o, weight } : o));
  return { ...icp, criteria };
}
export function icpCategories(icp: Obj): string[] {
  return objArr(icp.categories).map((o) => str(o, "name") || str(o, "account_category_name") || str(o, "account_category_id")).filter(Boolean);
}

export type SettingsProblem = { area: "org" | "alerts" | "discounts"; key: string };
export function validateSettings(s: Settings): SettingsProblem[] {
  const out: SettingsProblem[] = [];
  const o = s.organization;
  if ("name" in o && !String(o.name ?? "").trim()) out.push({ area: "org", key: "name" });
  if (typeof o.briefing_time === "string" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(o.briefing_time)) out.push({ area: "org", key: "briefing_time" });
  for (const k of ["visits_per_day", "approval_expiry_hours", "approval_sla_minutes", "recording_retention_days"]) {
    if (k in o && !(typeof o[k] === "number" && (o[k] as number) > 0)) out.push({ area: "org", key: k });
  }
  if ("icp_min_score" in o && !(typeof o.icp_min_score === "number" && o.icp_min_score >= 0 && o.icp_min_score <= 100)) out.push({ area: "org", key: "icp_min_score" });
  for (const r of s.alert_rules) if (r.threshold_value !== null && r.threshold_value < 0) out.push({ area: "alerts", key: r.alert_type_code });
  s.discount_policies.forEach((p, i) => {
    if (p.max_discount_pct < 0 || p.max_discount_pct > 100) out.push({ area: "discounts", key: String(i) });
  });
  return out;
}
