import { seedRows, type AccountRef, type AlertCard, type FunctionRequestMap, type FunctionResponseMap, type UserRef } from "../../../contracts";

/** Pure logic of the management Team screen (REQ-PLN-004). */

export type RepDetail = FunctionResponseMap["rep-detail"];
export const ORG_TZ = "Europe/Athens";

export type TeamMember = FunctionResponseMap["team-list"]["items"][number];

/** The roster from fn:team-list: active reps (the caller's reports, or everyone for an admin), by name. */
export function rosterFromTeam(items: readonly TeamMember[]): UserRef[] {
  return items
    .filter((m) => m.user.role === "rep" && m.status !== "inactive")
    .map((m) => m.user)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

/**
 * Seed fallback roster, used only when fn:team-list fails (same ids as the seeded dev workspace), so the
 * assign forms stay usable during an outage. Filterable by manager.
 */
export function teamRoster(managerId?: string | null): UserRef[] {
  return seedRows("app_user")
    .filter((u) => u.role_code === "rep" && u.status !== "inactive" && (!managerId || u.manager_id === managerId))
    .map((u) => ({ id: String(u.id), full_name: String(u.full_name), role: "rep" as const }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

/** YYYY-MM-DD of `d` in the org timezone. */
export function isoDay(d: Date, tz = ORG_TZ): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The rep-detail window: the last `days` days up to today (org timezone). */
export function detailRange(now: Date = new Date(), days = 14): { from: string; to: string } {
  const to = isoDay(now);
  return { from: addDays(to, -(days - 1)), to };
}

/** Tomorrow in the org timezone: the default day for an assigned visit. */
export const tomorrow = (now: Date = new Date()): string => addDays(isoDay(now), 1);

/** Accounts the manager can assign a visit for: the rep's recent visits and alerts, then team alerts. Deduped by id. */
export function accountOptions(detail: RepDetail | null, teamAlerts: readonly AlertCard[] = []): AccountRef[] {
  const out = new Map<string, AccountRef>();
  const add = (a: AccountRef | null | undefined) => {
    if (a && !out.has(a.id)) out.set(a.id, a);
  };
  detail?.recent_visits.forEach((v) => add(v.account));
  detail?.open_alerts.forEach((a) => add(a.account));
  teamAlerts.forEach((a) => add(a.account));
  return [...out.values()];
}

/** Flat, displayable KPI entries of rep-detail's free-form `kpis` object (numbers and strings only). */
export function kpiEntries(kpis: Record<string, unknown>): { key: string; value: string | number }[] {
  return Object.entries(kpis)
    .filter((e): e is [string, string | number] => typeof e[1] === "number" || typeof e[1] === "string")
    .map(([key, value]) => ({ key, value }));
}

/** "visits_done" -> "Visits done" when the screen has no label for a KPI key. */
export const humanize = (k: string): string => {
  const s = k.replace(/_/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : k;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface VisitForm {
  account_id: string | null;
  date: string;
  purpose: string;
}
export type VisitProblem = "account_required" | "date_required" | "date_past";

export function validateVisit(f: VisitForm, today: string): VisitProblem | null {
  if (!f.account_id) return "account_required";
  if (!DATE.test(f.date)) return "date_required";
  if (f.date < today) return "date_past";
  return null;
}

export function visitAssignRequest(repId: string, f: VisitForm): FunctionRequestMap["visit-assign"] {
  const body: FunctionRequestMap["visit-assign"] = { rep_id: repId, account_id: f.account_id!, date: f.date };
  const purpose = f.purpose.trim();
  if (purpose) body.purpose = purpose;
  return body;
}

export interface TaskForm {
  title: string;
  due: string;
  account_id: string | null;
}
export type TaskProblem = "title_required" | "title_too_long" | "due_invalid";

export function validateTask(f: TaskForm): TaskProblem | null {
  const title = f.title.trim();
  if (!title) return "title_required";
  if (title.length > 200) return "title_too_long";
  if (f.due && !DATE.test(f.due)) return "due_invalid";
  return null;
}

/** A due date becomes 18:00 org time on that day (Athens is UTC+2 in winter, +3 in summer). */
export function dueAt(day: string, tz = ORG_TZ): string {
  const probe = new Date(`${day}T16:00:00Z`);
  const local = new Date(probe.toLocaleString("en-US", { timeZone: tz }));
  const utc = new Date(probe.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMin = Math.round((local.getTime() - utc.getTime()) / 60000);
  return new Date(Date.parse(`${day}T18:00:00Z`) - offsetMin * 60000).toISOString();
}

export function taskAssignRequest(repId: string, f: TaskForm): FunctionRequestMap["task-assign"] {
  const body: FunctionRequestMap["task-assign"] = { rep_id: repId, title: f.title.trim() };
  if (f.due) body.due_at = dueAt(f.due);
  if (f.account_id) body.account_id = f.account_id;
  return body;
}

export const SEVERITY_ORDER: Record<AlertCard["severity"], number> = { high: 0, medium: 1, low: 2 };
export const sortAlerts = (xs: readonly AlertCard[]): AlertCard[] =>
  [...xs].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || Date.parse(b.created_at) - Date.parse(a.created_at));
