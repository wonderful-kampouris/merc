// Table-derived measures behind the contract monitors (contracts/platform/platform.json#monitors, REQ-OPS-003).
// The platform's native monitor metrics cannot read Merc tables, so each of these is evaluated by a
// merc-watch-<key> cron function that FAILS its run on a breach; a CronFunctionFailure monitor scoped to that
// function then opens the incident. Pure over a row source, so it is unit-tested against in-memory rows.
// No personal data leaves this module: results carry row ids and numbers only (REQ-NFR-005).
import type { Filter, OrderBy, TablesApi } from "../../../shared/core/src/tables";

export type Row = Record<string, any>;
export interface Source {
  rows(table: string, filters: Filter[], orderBy?: OrderBy, limit?: number): Promise<Row[]>;
}

/** Row source over the platform `context.tables` (or any TablesApi). System timestamps may sit on the envelope. */
export function tablesSource(api: TablesApi, schema = "merc"): Source {
  return {
    async rows(table, filters, orderBy, limit = 1000) {
      const res = await api.filter(`${schema}.${table}`, filters, limit, 0, orderBy);
      return res.rows.map((e) => {
        const env = e as unknown as Row;
        return { ...e.data, id: e.data.id ?? e.id, created_at: e.data.created_at ?? env.created_at, updated_at: e.data.updated_at ?? env.updated_at };
      });
    },
  };
}

/** Epoch ms of an ISO string, epoch ms or epoch seconds; NaN when absent. */
export function tsOf(v: unknown): number {
  if (typeof v === "number") return v < 1e11 ? v * 1000 : v;
  if (typeof v === "string" && v) { const n = Date.parse(v); return Number.isNaN(n) && /^\d+$/.test(v) ? tsOf(Number(v)) : n; }
  return NaN;
}
/** Nearest-rank percentile (p in 0..100) of a list; null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

export type WatchKey = "debrief-latency" | "voice-log-failures" | "approval-sla-breach" | "message-send-failures" | "previsit-brief-missed" | "debrief-confirm-latency";
export interface Measured { value: number; samples: number; ids: string[] }
export interface WatchDef {
  key: WatchKey;
  /** The contract sentence this watch implements (platform.json#monitors[key]). */
  contract: string;
  window_ms: number;
  /** Breach when value > threshold. */
  threshold: number;
  unit: "ms" | "count";
  /** Cron expression of the backing merc-watch-<key> function. */
  cron: string;
  measure(src: Source, now: number): Promise<Measured>;
}
export interface Evaluation { key: WatchKey; value: number; threshold: number; unit: string; samples: number; window_ms: number; breached: boolean; ids: string[]; at: string }

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const RECENT: OrderBy = [{ column: "updated_at", direction: "desc" }];
const within = (t: number, now: number, w: number) => Number.isFinite(t) && t <= now + MIN && t >= now - w;
const changedAt = (r: Row) => { const u = tsOf(r.updated_at); return Number.isFinite(u) ? u : tsOf(r.created_at); };

async function countChanged(src: Source, table: string, filters: Filter[], now: number, w: number): Promise<Measured> {
  const hit = (await src.rows(table, filters, RECENT)).filter((r) => within(changedAt(r), now, w));
  return { value: hit.length, samples: hit.length, ids: hit.map((r) => String(r.id)) };
}

export const WATCHES: Record<WatchKey, WatchDef> = {
  "debrief-latency": {
    key: "debrief-latency", contract: "p95 debrief-process duration > 20 s over 15 min",
    window_ms: 15 * MIN, threshold: 20_000, unit: "ms", cron: "*/5 * * * *",
    async measure(src, now) {
      const rows = (await src.rows("voice_log", [{ column: "processing_ms", operator: "is_not_null" }], RECENT))
        .filter((r) => typeof r.processing_ms === "number" && within(tsOf(r.processed_at), now, this.window_ms));
      const slow = rows.filter((r) => r.processing_ms > this.threshold);
      return { value: percentile(rows.map((r) => r.processing_ms), 95) ?? 0, samples: rows.length, ids: slow.map((r) => String(r.id)) };
    },
  },
  "voice-log-failures": {
    key: "voice-log-failures", contract: "voice_log status=failed > 3 per hour",
    window_ms: HOUR, threshold: 3, unit: "count", cron: "*/15 * * * *",
    measure(src, now) { return countChanged(src, "voice_log", [{ column: "status", operator: "eq", value: "failed" }], now, this.window_ms); },
  },
  "approval-sla-breach": {
    key: "approval-sla-breach", contract: "approvals escalated > 0 per day (info)",
    window_ms: DAY, threshold: 0, unit: "count", cron: "0 * * * *",
    measure(src, now) { return countChanged(src, "approval", [{ column: "status", operator: "eq", value: "escalated" }], now, this.window_ms); },
  },
  "message-send-failures": {
    key: "message-send-failures", contract: "message-send failed > 0 per hour",
    window_ms: HOUR, threshold: 0, unit: "count", cron: "*/15 * * * *",
    measure(src, now) {
      return countChanged(src, "approval", [{ column: "kind", operator: "eq", value: "customer_message" }, { column: "status", operator: "eq", value: "failed" }], now, this.window_ms);
    },
  },
  "previsit-brief-missed": {
    key: "previsit-brief-missed", contract: "planned visit started with no visit_brief sent > 0 per day (REQ-MTG-001)",
    window_ms: DAY, threshold: 0, unit: "count", cron: "0 * * * *",
    async measure(src, now) {
      const started = (await src.rows("visit", [{ column: "started_at", operator: "is_not_null" }, { column: "planned_start_at", operator: "is_not_null" }], RECENT))
        .filter((v) => within(tsOf(v.started_at), now, this.window_ms));
      if (!started.length) return { value: 0, samples: 0, ids: [] };
      const briefs = await src.rows("visit_brief", [{ column: "visit_id", operator: "in", value: started.map((v) => v.id) }], RECENT);
      const sent = new Set(briefs.filter((b) => (b.status === "sent" || b.status === "called") && b.sent_at && tsOf(b.sent_at) <= tsOf(started.find((v) => v.id === b.visit_id)?.started_at) + MIN).map((b) => String(b.visit_id)));
      const missed = started.filter((v) => !sent.has(String(v.id)));
      return { value: missed.length, samples: started.length, ids: missed.map((v) => String(v.id)) };
    },
  },
  "debrief-confirm-latency": {
    key: "debrief-confirm-latency", contract: "debrief_confirmation sent_at - voice_log processed_at p95 > 60 s over 1 h (REQ-MTG-006)",
    window_ms: HOUR, threshold: 60_000, unit: "ms", cron: "*/15 * * * *",
    async measure(src, now) {
      const confs = (await src.rows("debrief_confirmation", [{ column: "sent_at", operator: "is_not_null" }], RECENT)).filter((c) => within(tsOf(c.sent_at), now, this.window_ms));
      if (!confs.length) return { value: 0, samples: 0, ids: [] };
      const vls = await src.rows("voice_log", [{ column: "id", operator: "in", value: [...new Set(confs.map((c) => c.voice_log_id))] }]);
      const processed = new Map(vls.map((v) => [String(v.id), tsOf(v.processed_at)]));
      const lat: Array<[string, number]> = [];
      for (const c of confs) { const p = processed.get(String(c.voice_log_id)); if (p !== undefined && Number.isFinite(p)) lat.push([String(c.id), Math.max(0, tsOf(c.sent_at) - p)]); }
      return { value: percentile(lat.map(([, ms]) => ms), 95) ?? 0, samples: lat.length, ids: lat.filter(([, ms]) => ms > this.threshold).map(([id]) => id) };
    },
  },
};

/**
 * Synthetic rows for a live fire drill (REQ-OPS-003 "fires on an injected slow run"). They come only from the
 * cron schedule's `params` (set by the deployer with `wful functions cron update`), never from a table or a user,
 * and they are added on top of the real rows without writing anything. Row ids are forced to `synthetic-*` so a
 * breach message always shows the drill. Timestamps default to `now`.
 */
export type Injected = Record<string, Row[]>;
export function withInjected(src: Source, inject: unknown, now: number): Source {
  if (!inject || typeof inject !== "object" || Array.isArray(inject)) return src;
  const iso = new Date(now).toISOString();
  const extra: Injected = {};
  for (const [t, rows] of Object.entries(inject as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    extra[t] = rows.filter((r) => r && typeof r === "object").slice(0, 50).map((r, i) => ({ processed_at: iso, updated_at: iso, created_at: iso, ...(r as Row), id: `synthetic-${i + 1}` }));
  }
  return {
    async rows(table, filters, orderBy, limit) {
      const real = await src.rows(table, filters, orderBy, limit);
      const fake = (extra[table] ?? []).filter((r) => filters.every((f) => matches(r, f)));
      return [...real, ...fake];
    },
  };
}
// Filter semantics for synthetic rows, for the operators the watches use (kept local: this file is also run by
// node's type stripping in build.ts, which cannot resolve the extensionless shared/core imports).
function matches(r: Row, f: Filter): boolean {
  const v = r[f.column];
  switch (f.operator) {
    case "eq": return v === f.value;
    case "is_not_null": return v !== null && v !== undefined;
    case "is_null": return v === null || v === undefined;
    case "in": return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
    default: return false;
  }
}

export const WATCH_KEYS = Object.keys(WATCHES) as WatchKey[];
export const isWatchKey = (k: unknown): k is WatchKey => typeof k === "string" && k in WATCHES;

export async function evaluate(key: WatchKey, src: Source, now = Date.now()): Promise<Evaluation> {
  const w = WATCHES[key];
  const m = await w.measure(src, now);
  return { key, value: m.value, threshold: w.threshold, unit: w.unit, samples: m.samples, window_ms: w.window_ms, breached: m.value > w.threshold, ids: m.ids.slice(0, 20), at: new Date(now).toISOString() };
}
