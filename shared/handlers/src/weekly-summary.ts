// fn:weekly-summary (cron "0 7 * * 1", contracts/functions/weekly-summary.json, REQ-DSH-005).
// Creates one merc-ops backoffice task `weekly_summary` per active manager and admin, covering last week
// (Mon..Sun in the org timezone). merc-ops then calls get_summary_data (fn:summary-data, the only source of numbers)
// and emails the recipient with send_internal_email.
// The task is created through the merc-ops webhook trigger: POST <public_url> with header X-Webhook-Secret.
//   global variable MERC_OPS_WEEKLY_URL  = the trigger public_url      (wful agents triggers list merc-ops)
//   secret          MERC_OPS_WEEKLY_HOOK = the trigger webhook secret
// While either is unset the cron answers blocked_by_policy naming it (dry_run still lists the recipients).
// The shared ops-task logic below is reused by fn:monthly-report.
import {
  addDays, blocked, defineCron, globalString, monthRange, secretString, startOfMonth, startOfWeek, today,
  type Db, type FunctionContext, type Impl, type PlatformLike, type Principal, type Row,
} from "../../core/src/index";
import { cronData } from "./metrics-rollup";

export type OpsKind = "weekly" | "monthly";
export type OpsTaskType = "weekly_summary" | "monthly_report";
export const TASK_TYPE: Record<OpsKind, OpsTaskType> = { weekly: "weekly_summary", monthly: "monthly_report" };
/** Names of the platform values that wire a kind to its merc-ops webhook trigger (not the values). */
export const HOOK_NAMES: Record<OpsKind, { url: string; key: string }> = {
  weekly: { url: "MERC_OPS_WEEKLY_URL", key: "MERC_OPS_WEEKLY_HOOK" },
  monthly: { url: "MERC_OPS_MONTHLY_URL", key: "MERC_OPS_MONTHLY_HOOK" },
};
export const HEADER_HOOK = "X-Webhook-Secret";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json?(): Promise<unknown>; text?(): Promise<string> }>;
export interface OpsDeps { fetch?: FetchLike; now?: () => number }

/** The reporting period: last week (Mon..Sun) or last month, as local dates of the org. */
export function opsPeriod(kind: OpsKind, day: string): { from: string; to: string } {
  if (kind === "weekly") { const from = addDays(startOfWeek(day), -7); return { from, to: addDays(from, 6) }; }
  const r = monthRange("UTC", addDays(startOfMonth(day), -1));
  return { from: r.fromDate, to: r.toDate };
}

/** Recipients: weekly -> active managers and admins, monthly -> active admins (REQ-DSH-005). */
export async function opsRecipients(db: Db, kind: OpsKind): Promise<Row<"app_user">[]> {
  const roles = kind === "weekly" ? ["manager", "admin"] : ["admin"];
  return (await db.app_user.all({ status: "active", role_code: roles })).sort((a, b) => a.role_code.localeCompare(b.role_code) || a.full_name.localeCompare(b.full_name));
}

export interface OpsPayload {
  kind: OpsKind; task_type: OpsTaskType; org_id: string; org_name: string; scope_user_id: string;
  recipient: { name: string; email: string; role: string; language: string }; from: string; to: string; instructions: string;
}

export function opsPayload(kind: OpsKind, org: Row<"organization">, u: Row<"app_user">, period: { from: string; to: string }): OpsPayload {
  const language = u.preferred_language || org.default_language;
  return {
    kind, task_type: TASK_TYPE[kind], org_id: org.id, org_name: org.name, scope_user_id: u.id,
    recipient: { name: u.full_name, email: u.email!, role: u.role_code, language }, from: period.from, to: period.to,
    instructions: `Write the ${kind} ${kind === "weekly" ? "summary" : "report"} for ${u.full_name} (${u.role_code}) in ${language === "el" ? "Greek" : "English"}: call get_summary_data with kind=${kind}, scope_user_id=${u.id}, from=${period.from}, to=${period.to}; use only its numbers; send it with send_internal_email to ${u.email}.`,
  };
}

const fetchOf = (deps: OpsDeps): FetchLike | null => deps.fetch ?? (typeof (globalThis as { fetch?: unknown }).fetch === "function" ? ((url, init) => (globalThis as any).fetch(url, init)) : null);

/** POST one task to the merc-ops webhook trigger. Returns the platform task id when it answers one. */
export async function postOpsTask(deps: OpsDeps, hook: { url: string; key: string }, payload: OpsPayload): Promise<{ ok: boolean; status: number; task_id: string | null; error?: string }> {
  const f = fetchOf(deps);
  if (!f) return { ok: false, status: 0, task_id: null, error: "no fetch in this runtime" };
  try {
    const res = await f(hook.url, { method: "POST", headers: { "Content-Type": "application/json", [HEADER_HOOK]: hook.key }, body: JSON.stringify(payload) });
    let body: any = null;
    try { body = res.json ? await res.json() : null; } catch { body = null; }
    const d = body?.data ?? body ?? {};
    const task_id = typeof d.task_id === "string" ? d.task_id : typeof d.id === "string" ? d.id : null;
    return res.ok ? { ok: true, status: res.status, task_id } : { ok: false, status: res.status, task_id: null, error: String(d?.message ?? d?.error?.message ?? `HTTP ${res.status}`).slice(0, 200) };
  } catch (e) {
    return { ok: false, status: 0, task_id: null, error: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

/** The webhook wiring of a kind, or blocked_by_policy naming exactly what is missing. */
export function opsHook(platform: PlatformLike, kind: OpsKind): { url: string; key: string } {
  const n = HOOK_NAMES[kind];
  const url = globalString(platform, n.url);
  const key = secretString(platform, n.key);
  const missing = [...(url ? [] : [{ name: n.url, kind: "global variable" }]), ...(key ? [] : [{ name: n.key, kind: "secret" }])];
  if (missing.length) {
    throw blocked(`${kind === "weekly" ? "weekly-summary" : "monthly-report"} is blocked: ${missing.map((m) => `${m.kind} ${m.name}`).join(" and ")} not set in this workspace`, {
      missing: missing.map((m) => m.name),
      how: `run \`wful agents triggers list merc-ops --json\`; set global variable ${n.url} (string) to the ${TASK_TYPE[kind]} trigger public_url and secret ${n.key} (type API Key) to its webhook_secret`,
    });
  }
  return { url: url!, key: key! };
}

/** Shared cron body: one merc-ops task per recipient. dry_run lists them and creates nothing. */
export function makeOpsImpl<S extends "weekly-summary" | "monthly-report">(kind: OpsKind, deps: OpsDeps = {}): Impl<S, Principal> {
  return (async ({ req, db, me, platform }) => {
    const dry = (req as { dry_run?: boolean | null }).dry_run === true;
    const org = me.org;
    const day = today(org, deps.now?.() ?? Date.now());
    const period = opsPeriod(kind, day);
    const users = await opsRecipients(db, kind);
    const withEmail = users.filter((u) => !!u.email);
    const skipped = users.filter((u) => !u.email).map((u) => ({ user_id: u.id, reason: "no email" }));
    const tasks: Array<{ user_id: string; name: string; email: string; task_id: string | null; status: string; error?: string }> = [];
    if (dry || !withEmail.length) {
      for (const u of withEmail) tasks.push({ user_id: u.id, name: u.full_name, email: u.email!, task_id: null, status: "dry_run" });
      return { processed: users.length, created: 0, details: { dry_run: dry, kind, task_type: TASK_TYPE[kind], period, tasks, skipped } };
    }
    const hook = opsHook(platform, kind);
    let created = 0;
    for (const u of withEmail) {
      const r = await postOpsTask(deps, hook, opsPayload(kind, org, u, period));
      if (r.ok) created++;
      tasks.push({ user_id: u.id, name: u.full_name, email: u.email!, task_id: r.task_id, status: r.ok ? "created" : "failed", ...(r.error ? { error: r.error } : {}) });
    }
    return { processed: users.length, created, details: { dry_run: false, kind, task_type: TASK_TYPE[kind], period, tasks, skipped } };
  }) as Impl<S, Principal>;
}

export const makeImpl = (deps: OpsDeps = {}) => makeOpsImpl<"weekly-summary">("weekly", deps);
export const impl = makeImpl();
/** Cron entry (functions/weekly-summary/index.ts): once per org, system principal; only `dry_run` is read from params. */
export const handle = (context: FunctionContext & { params?: unknown }) => defineCron("weekly-summary", impl)({ ...context, data: cronData(context) });
