// Cron entry of merc-watch-<key> (bundled by src/build.ts with the key baked in as MERC_WATCH_KEY).
// A breach FAILS the run on purpose: the CronFunctionFailure monitor scoped to this function opens the incident.
// Logs carry the key, numbers and row ids only, never names, phones or emails (REQ-NFR-005).
import type { TablesApi } from "../../../shared/core/src/tables";
import { evaluate, isWatchKey, tablesSource, withInjected, type Evaluation } from "./watches.ts";

declare const MERC_WATCH_KEY: string;

export class MonitorBreach extends Error {
  constructor(readonly evaluation: Evaluation) {
    super(`MERC_MONITOR_BREACH ${evaluation.key}: ${evaluation.value}${evaluation.unit === "ms" ? " ms" : ""} > ${evaluation.threshold} (samples ${evaluation.samples}, ids ${evaluation.ids.join(",") || "-"})`);
    this.name = "MonitorBreach";
  }
}

export async function handle(context: { tables: TablesApi; data?: { monitor?: unknown; now?: unknown; inject_rows?: unknown } }, bakedKey: string = typeof MERC_WATCH_KEY === "string" ? MERC_WATCH_KEY : ""): Promise<Evaluation> {
  const key = bakedKey || context.data?.monitor;
  if (!isWatchKey(key)) throw new Error(`merc-watch: unknown monitor key ${JSON.stringify(key)}`);
  const now = typeof context.data?.now === "number" ? context.data.now : Date.now();
  const r = await evaluate(key, withInjected(tablesSource(context.tables), context.data?.inject_rows, now), now);
  console.log(JSON.stringify({ watch: r.key, value: r.value, threshold: r.threshold, samples: r.samples, breached: r.breached, ...(context.data?.inject_rows ? { drill: true } : {}) }));
  if (r.breached) throw new MonitorBreach(r);
  return r;
}
