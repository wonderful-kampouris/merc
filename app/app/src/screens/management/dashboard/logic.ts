import type { KpiDrilldownRequest, KpiSet, TargetProgress } from "../../../contracts";
import type { Lang } from "../../../lib/i18n";
import { money, num, numberOr, pct } from "./shared/format";

export type DrillKpi = KpiDrilldownRequest["kpi"];
export type TileFormat = "money" | "count" | "pct" | "rate";

export interface TileDef {
  /** KpiSet field, or a synthetic pair key (`ai_actions`, `approvals`, `discounts`). */
  key: string;
  format: TileFormat;
  /** kpi-drilldown `kpi` for this figure: every KPI drills down to the records behind it (REQ-DSH-002). */
  drill: DrillKpi;
  /** Lower is better (risk, lost): the baseline delta reads as good when it goes down. */
  lowerIsBetter?: boolean;
  /** Pair tiles show `a / b` of two KpiSet fields. */
  pair?: [keyof KpiSet, keyof KpiSet];
}

export interface TileGroup {
  key: "sales" | "customers" | "discipline" | "ai";
  tiles: TileDef[];
}

/** The KPI set of fn:dashboard-kpis (contracts/metrics.md), grouped for the page. */
export const TILE_GROUPS: readonly TileGroup[] = [
  {
    key: "sales",
    tiles: [
      { key: "revenue_minor", format: "money", drill: "revenue" },
      { key: "weighted_pipeline_minor", format: "money", drill: "pipeline" },
      { key: "new_customers", format: "count", drill: "new_customers" },
    ],
  },
  {
    key: "customers",
    tiles: [
      { key: "at_risk_customers", format: "count", drill: "at_risk", lowerIsBetter: true },
      { key: "at_risk_value_minor", format: "money", drill: "at_risk", lowerIsBetter: true },
      { key: "customers_saved", format: "count", drill: "customers_saved" },
      { key: "lost_customers", format: "count", drill: "lost", lowerIsBetter: true },
    ],
  },
  {
    key: "discipline",
    tiles: [
      { key: "visits_per_rep_day", format: "rate", drill: "visits" },
      { key: "voice_logs_per_rep_day", format: "rate", drill: "low_logging" },
      { key: "voice_logs_within_1h_pct", format: "pct", drill: "low_logging" },
      { key: "crm_completeness_pct", format: "pct", drill: "incomplete_accounts" },
    ],
  },
  {
    key: "ai",
    tiles: [
      { key: "ai_actions", format: "count", drill: "ai_actions", pair: ["ai_actions_applied", "ai_actions_undone"] },
      { key: "approvals", format: "count", drill: "approvals", pair: ["approvals_approved", "approvals_rejected"] },
      { key: "discounts", format: "count", drill: "discounts", pair: ["discounts_approved", "discount_requests"] },
    ],
  },
];

export const ALL_TILES: readonly TileDef[] = TILE_GROUPS.flatMap((g) => g.tiles);

export function formatValue(v: number, format: TileFormat, lang: Lang): string {
  switch (format) {
    case "money":
      return money(v, lang, true);
    case "pct":
      return pct(v, lang);
    case "rate":
      return num(v, lang, 1);
    default:
      return num(v, lang, 0);
  }
}

const field = (k: Record<string, unknown>, key: string): number => numberOr(k[key]);

/** The tile's display value: a single figure, or `a / b` for pairs. */
export function tileValue(k: KpiSet, tile: TileDef, lang: Lang): string {
  const rec = k as unknown as Record<string, unknown>;
  if (tile.pair) return `${formatValue(field(rec, tile.pair[0]), tile.format, lang)} / ${formatValue(field(rec, tile.pair[1]), tile.format, lang)}`;
  return formatValue(field(rec, tile.key), tile.format, lang);
}

export interface BaselineDelta {
  before: number;
  /** Signed change, in the metric's unit (points for pct). */
  delta: number;
  direction: "up" | "down";
  good: boolean;
}

/**
 * Before/after against the baseline (metrics.md#before-after): `kpis.baseline` holds the same metric over
 * `baseline_start .. go_live_date`. Only numeric fields of the same name are compared.
 */
export function baselineDelta(k: KpiSet, tile: TileDef): BaselineDelta | undefined {
  if (tile.pair || !k.baseline || typeof k.baseline !== "object") return undefined;
  const before = k.baseline[tile.key];
  if (typeof before !== "number" || !Number.isFinite(before)) return undefined;
  const now = field(k as unknown as Record<string, unknown>, tile.key);
  const delta = now - before;
  const up = delta >= 0;
  return { before, delta, direction: up ? "up" : "down", good: tile.lowerIsBetter ? !up || delta === 0 : up };
}

export function deltaLabel(d: BaselineDelta, tile: TileDef, lang: Lang): string {
  const sign = d.delta > 0 ? "+" : d.delta < 0 ? "−" : "±";
  const abs = Math.abs(d.delta);
  return tile.format === "pct" ? `${sign}${num(abs, lang, 0)} pp` : `${sign}${formatValue(abs, tile.format, lang)}`;
}

export interface StageBar {
  stage_code: string;
  amount_minor: number;
  count: number;
  /** Width share of the largest stage, 0-100 (for the bar). */
  share: number;
}

/** Pipeline rows in the contract's stage order, with bar shares relative to the largest stage. */
export function stageBars(k: KpiSet, order: readonly string[] = []): StageBar[] {
  const rows = [...(k.pipeline_by_stage ?? [])];
  const pos = (c: string) => {
    const i = order.indexOf(c);
    return i < 0 ? order.length : i;
  };
  rows.sort((a, b) => pos(a.stage_code) - pos(b.stage_code));
  const max = Math.max(0, ...rows.map((r) => r.amount_minor));
  return rows.map((r) => ({ ...r, share: max > 0 ? Math.round((100 * r.amount_minor) / max) : 0 }));
}

export type Pace = "ahead" | "behind" | "off";

/**
 * Target pace: `pct` (metrics.md#target-progress) against the share of the period already elapsed.
 * ahead: on or above the straight line; behind: at least 80% of it; off: below.
 */
export function targetPace(t: TargetProgress, today: Date = new Date()): Pace {
  const start = Date.parse(`${t.period_start}T00:00:00Z`);
  const end = Date.parse(`${t.period_end}T23:59:59Z`);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const elapsed = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 1;
  const expected = 100 * elapsed;
  if (t.pct >= expected) return "ahead";
  if (t.pct >= 0.8 * expected) return "behind";
  return "off";
}

export const paceColor = (p: Pace): "success" | "warning" | "danger" => (p === "ahead" ? "success" : p === "behind" ? "warning" : "danger");

/** Actual and target in the metric's unit: revenue is money (minor), the rest are counts. */
export function targetFigures(t: TargetProgress, lang: Lang): { actual: string; target: string } {
  const f = (v: number) => (t.metric === "revenue" ? money(v, lang, true) : num(v, lang, 0));
  return { actual: f(t.actual_value), target: f(t.target_value) };
}

/** The KPI columns of the by-rep table (fields of `by_rep[].kpis`, a KpiSet subset). */
export type RepColumn = Pick<TileDef, "key" | "format">;
export const REP_COLUMNS: readonly RepColumn[] = [
  { key: "revenue_minor", format: "money" },
  { key: "visits_per_rep_day", format: "rate" },
  { key: "voice_logs_within_1h_pct", format: "pct" },
  { key: "at_risk_customers", format: "count" },
  { key: "crm_completeness_pct", format: "pct" },
];

export function repCell(kpis: Record<string, unknown>, col: RepColumn, lang: Lang): string {
  const v = kpis[col.key];
  return typeof v === "number" ? formatValue(v, col.format, lang) : "—";
}

/** Build the dashboard-kpis request from the page filters (scalar GET params only). */
export function kpiRequest(f: { scope: "team" | "org"; from: string; to: string; territoryId: string | null; repId: string | null }) {
  return {
    scope: f.scope,
    from: f.from,
    to: f.to,
    compare_baseline: true,
    ...(f.territoryId ? { territory_id: f.territoryId } : {}),
    ...(f.repId ? { rep_id: f.repId } : {}),
  } as const;
}

/** One drill-down record as a list row: title plus a short description from the fields it has. */
export function drillRow(row: Record<string, unknown>, lang: Lang, names: (kind: "user" | "territory", id: unknown) => string | undefined): { id: string; title: string; description: string } {
  const parts: string[] = [];
  const s = (k: string) => (typeof row[k] === "string" && row[k] ? String(row[k]) : undefined);
  for (const k of ["account_type", "stage_code", "city", "reason", "status"]) if (s(k)) parts.push(s(k)!);
  for (const k of ["amount_minor", "value_minor", "at_risk_value_minor"]) if (typeof row[k] === "number") parts.push(money(row[k] as number, lang));
  if (typeof row.risk_score === "number") parts.push(`risk ${num(row.risk_score as number, lang, 0)}`);
  if (typeof row.completeness_pct === "number") parts.push(pct(row.completeness_pct as number, lang));
  const owner = names("user", row.owner_rep_id ?? row.owner_id ?? row.rep_id);
  if (owner) parts.push(owner);
  const title =
    (["name", "title", "full_name", "account_name"].map(s).find(Boolean) as string | undefined) ??
    (typeof row.id === "string" ? `#${row.id.slice(0, 8)}` : "—");
  return { id: typeof row.id === "string" ? row.id : JSON.stringify(row).slice(0, 40), title, description: parts.join(" · ") };
}
