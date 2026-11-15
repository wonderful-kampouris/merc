import type { TargetProgress, TargetUpsertRequest } from "../../../contracts";
import { monthRange, type Period } from "../dashboard/shared/period";

export type Metric = TargetUpsertRequest["metric"];
export type Scope = TargetUpsertRequest["scope"];
export const METRICS: readonly Metric[] = ["revenue", "volume", "visits", "new_customers"];
export const SCOPES: readonly Scope[] = ["user", "territory", "org"];

export type PeriodChoice = "this" | "next" | "last" | "all";
export const PERIOD_CHOICES: readonly PeriodChoice[] = ["this", "next", "last", "all"];

export function periodOf(choice: PeriodChoice, today: Date = new Date()): Period | null {
  switch (choice) {
    case "this":
      return monthRange(0, today);
    case "next":
      return monthRange(1, today);
    case "last":
      return monthRange(-1, today);
    default:
      return null;
  }
}

/** targets-list request for a period choice (`period_start` is the month's first day). */
export const listRequest = (choice: PeriodChoice, today?: Date) => {
  const p = periodOf(choice, today);
  return p ? { period_start: p.from } : {};
};

export interface TargetForm {
  target_id: string | null;
  scope: Scope;
  territory_id: string;
  user_id: string;
  metric: Metric;
  period_start: string;
  period_end: string;
  /** In the metric's unit: euros for revenue, counts otherwise. */
  value: number | null;
}

export const blankForm = (today?: Date): TargetForm => {
  const m = monthRange(0, today);
  return { target_id: null, scope: "user", territory_id: "", user_id: "", metric: "revenue", period_start: m.from, period_end: m.to, value: null };
};

/** Edit form from a listed target. TargetProgress has no scope fields (contract gap), so scope comes from extra fields when the function sends them. */
export function formFromTarget(t: TargetProgress): TargetForm {
  const x = t as TargetProgress & Record<string, unknown>;
  const territory_id = typeof x.territory_id === "string" ? x.territory_id : "";
  const user_id = typeof x.user_id === "string" ? x.user_id : "";
  const scope: Scope = x.scope === "org" || x.scope === "territory" || x.scope === "user" ? x.scope : user_id ? "user" : territory_id ? "territory" : "user";
  return {
    target_id: t.target_id,
    scope,
    territory_id,
    user_id,
    metric: t.metric,
    period_start: t.period_start,
    period_end: t.period_end,
    value: t.metric === "revenue" ? t.target_value / 100 : t.target_value,
  };
}

/** True when the listed target carries who it belongs to (so the edit form is complete). */
export const knowsScope = (t: TargetProgress): boolean => {
  const f = formFromTarget(t);
  return f.scope === "org" ? (t as unknown as Record<string, unknown>).scope === "org" : !!(f.user_id || f.territory_id);
};

export type FormError = "v.scopeId" | "v.period" | "v.value" | "v.dates";

export function validate(f: TargetForm): FormError[] {
  const out: FormError[] = [];
  if (f.scope === "user" && !f.user_id) out.push("v.scopeId");
  if (f.scope === "territory" && !f.territory_id) out.push("v.scopeId");
  if (!f.period_start || !f.period_end) out.push("v.dates");
  else if (f.period_end < f.period_start) out.push("v.period");
  if (f.value === null || !(f.value > 0)) out.push("v.value");
  return out;
}

/** target-upsert body: only the scope's id is sent; revenue euros -> minor units (contracts/README.md#units). */
export function upsertRequest(f: TargetForm): TargetUpsertRequest {
  const value = f.value ?? 0;
  return {
    ...(f.target_id ? { target_id: f.target_id } : {}),
    scope: f.scope,
    ...(f.scope === "territory" ? { territory_id: f.territory_id } : {}),
    ...(f.scope === "user" ? { user_id: f.user_id } : {}),
    metric: f.metric,
    period_start: f.period_start,
    period_end: f.period_end,
    target_value: f.metric === "revenue" ? Math.round(value * 100) : Math.round(value),
  };
}

/** Listed targets grouped by metric, in METRICS order; each group sorted by pct ascending (who needs help first). */
export function byMetric(items: readonly TargetProgress[]): { metric: Metric; items: TargetProgress[] }[] {
  return METRICS.map((metric) => ({ metric, items: items.filter((t) => t.metric === metric).sort((a, b) => a.pct - b.pct) })).filter((g) => g.items.length > 0);
}
