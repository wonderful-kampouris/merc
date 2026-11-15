// One platform monitor per contract monitor (contracts/platform/platform.json#monitors, REQ-OPS-003).
// Native metric where the platform has one (function-errors -> ApiFunctionFailure); otherwise a
// CronFunctionFailure monitor scoped to the merc-watch-<key> cron that fails on a breach (see watches.ts).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WATCHES, isWatchKey, type WatchKey } from "./watches.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "../../..");
export const PLATFORM_JSON = join(ROOT, "spec/contracts/platform/platform.json");

export const contractMonitors = (): Record<string, string> => JSON.parse(readFileSync(PLATFORM_JSON, "utf8")).monitors;

export type Severity = "Critical" | "High" | "Medium" | "Low";
export const PREFIX = "merc-";
export const watchSlug = (key: WatchKey) => `merc-watch-${key}`;
export const monitorName = (key: string) => `${PREFIX}${key}`;

export const SEVERITY: Record<string, Severity> = {
  "debrief-latency": "High",
  "function-errors": "High",
  "voice-log-failures": "Medium",
  "approval-sla-breach": "Low",
  "message-send-failures": "High",
  "previsit-brief-missed": "Low",
  "debrief-confirm-latency": "Medium",
};

export interface Recipient { kind: "email" | "sms" | "user_email" | "group_email"; value: string }
export interface MonitorBody {
  name: string; description: string; metric: string; estimator: string;
  window_value: number; time_unit: "Minutes" | "Hours" | "Days"; interval: number;
  resource_type: "api_function" | "cron_function"; resource_id: string | null;
  severity: Severity; timezone: string; active: boolean; active_schedule: never[];
  trigger_conditions: { operator: "Or"; children: Array<{ comparison_operator: "GreaterThan"; value: number }> };
  recipients: Recipient[]; notification_note: string; reminder_frequency_minutes: number; notify_on_resolved_incidents: boolean;
}

/** function-errors: the platform counts failed API-function runs; it has no error-rate metric for functions. */
export const FUNCTION_ERRORS_THRESHOLD = 5;

const RUNBOOK = "Runbook: infra/monitors/README.md";
function window(ms: number): Pick<MonitorBody, "window_value" | "time_unit"> {
  if (ms % 86_400_000 === 0) return { window_value: ms / 86_400_000, time_unit: "Days" };
  if (ms % 3_600_000 === 0) return { window_value: ms / 3_600_000, time_unit: "Hours" };
  return { window_value: Math.round(ms / 60_000), time_unit: "Minutes" };
}

// Minutes between runs of a simple cron expression: "*/N * * * *" or "M * * * *".
export function cronPeriodMin(expr: string): number {
  const [m, h] = expr.trim().split(/\s+/);
  const step = /^\*\/(\d+)$/.exec(m ?? "");
  if (step && h === "*") return Number(step[1]);
  if (/^\d+$/.test(m ?? "") && h === "*") return 60;
  throw new Error(`unsupported cron expression for a watch: ${expr}`);
}

/**
 * The monitor body for one contract key. `cronIds` maps merc-watch-<key> slugs to their platform function ids.
 * Every key in platform.json must produce a body (tested), so a new contract monitor cannot be silently skipped.
 */
export function monitorBody(key: string, contract: string, cronIds: Record<string, string>, recipients: Recipient[] = []): MonitorBody {
  const base = { severity: SEVERITY[key] ?? "Medium", timezone: "Europe/Athens", active: true, active_schedule: [] as never[], recipients, reminder_frequency_minutes: 0, notify_on_resolved_incidents: true };
  if (key === "function-errors") {
    return {
      ...base, name: monitorName(key), metric: "ApiFunctionFailure", estimator: "LastValue", ...window(15 * 60_000), interval: 300,
      resource_type: "api_function", resource_id: null,
      description: `Contract: ${contract}. Platform metric is a failure COUNT across every API function in the workspace (no rate metric for functions): fires on more than ${FUNCTION_ERRORS_THRESHOLD} failed runs in 15 min.`,
      trigger_conditions: { operator: "Or", children: [{ comparison_operator: "GreaterThan", value: FUNCTION_ERRORS_THRESHOLD }] },
      notification_note: `${RUNBOOK}#function-errors`,
    };
  }
  if (!isWatchKey(key)) throw new Error(`no monitor implementation for contract monitor '${key}'`);
  const w = WATCHES[key];
  const id = cronIds[watchSlug(key)];
  if (!id) throw new Error(`cron function ${watchSlug(key)} is not deployed (no id); run infra/monitors/apply.sh --push first`);
  return {
    ...base, name: monitorName(key), metric: "CronFunctionFailure", estimator: "LastValue",
    ...window(2 * cronPeriodMin(w.cron) * 60_000), interval: 300,
    resource_type: "cron_function", resource_id: id,
    description: `Contract: ${contract}. Evaluated by cron ${watchSlug(key)} (${w.cron}) over Merc tables; a breach (${w.unit === "ms" ? `p95 > ${w.threshold} ms` : `count > ${w.threshold}`} over ${w.window_ms / 60_000} min) fails that run, and any failed run in the window opens this incident.`,
    trigger_conditions: { operator: "Or", children: [{ comparison_operator: "GreaterThan", value: 0 }] },
    notification_note: `${RUNBOOK}#${key}`,
  };
}

export function allBodies(cronIds: Record<string, string>, recipients: Recipient[] = []): MonitorBody[] {
  return Object.entries(contractMonitors()).map(([k, c]) => monitorBody(k, c, cronIds, recipients));
}
