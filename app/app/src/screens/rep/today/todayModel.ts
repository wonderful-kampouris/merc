import type { VisitSummary } from "../../../contracts";
import type { Lang } from "../../../lib/i18n";
import type { PlanResult, TodayData } from "./planCache";

/** Route order: route_position ascending (unset last), then name. Stable for equal keys. */
export function sortStops(visits: readonly VisitSummary[]): VisitSummary[] {
  const pos = (v: VisitSummary) => (typeof v.route_position === "number" ? v.route_position : Number.POSITIVE_INFINITY);
  return visits
    .map((v, i) => ({ v, i }))
    .sort((a, b) => pos(a.v) - pos(b.v) || a.v.account.name.localeCompare(b.v.account.name) || a.i - b.i)
    .map((x) => x.v);
}

export interface StopSummary {
  total: number;
  done: number;
  skipped: number;
  planned: number;
  next: VisitSummary | null;
}

export function summarizeStops(visits: readonly VisitSummary[]): StopSummary {
  const sorted = sortStops(visits);
  const count = (s: VisitSummary["status"]) => sorted.filter((v) => v.status === s).length;
  return {
    total: sorted.length,
    done: count("done"),
    skipped: count("skipped"),
    planned: count("planned"),
    next: sorted.find((v) => v.status === "planned") ?? null,
  };
}

/** Today's visits taken from the cached week plan, when the plan has the day but today-get was never cached for it. */
export function visitsForDate(plan: PlanResult | null, date: string): VisitSummary[] | null {
  const day = plan?.days.find((d) => d.date === date);
  return day ? day.visits : null;
}

/** Device-local calendar date (YYYY-MM-DD). */
export function localDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * The data to show from a cache entry on `date`: the cached day when it is that day; else the cached
 * week plan's visits for that day; else the cached day as it is, flagged stale.
 */
export function dataForDate(data: TodayData, date: string): { data: TodayData; stale: boolean } {
  if (data.today.date === date) return { data, stale: false };
  const fromPlan = visitsForDate(data.plan, date);
  if (fromPlan) {
    return {
      data: { ...data, today: { date, visits: fromPlan, briefing_id: null, pending_recordings_hint: data.today.pending_recordings_hint }, briefing: null },
      stale: false,
    };
  }
  return { data, stale: true };
}

const locale = (lang: Lang) => (lang === "el" ? "el-GR" : "en-GB");

/** Money is integer minor units in the org currency (contracts README). */
export function formatMoney(minor: number, lang: Lang, currency = "EUR"): string {
  return new Intl.NumberFormat(locale(lang), { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);
}

export function formatDay(date: string, lang: Lang): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Intl.DateTimeFormat(locale(lang), { weekday: "long", day: "numeric", month: "long" }).format(new Date(y, m - 1, d));
}

export function formatTime(iso: string, lang: Lang, now?: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const sameDay = now ? localDate(now) === localDate(at) : false;
  return new Intl.DateTimeFormat(locale(lang), sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(at);
}

/** Target value for display: revenue targets are minor units, others are plain counts. */
export function formatTargetValue(metric: string, value: number, lang: Lang): string {
  if (metric === "revenue") return formatMoney(value, lang);
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 1 }).format(value);
}

/** Percentages are 0-100 (contracts README); clamp for the progress bar. */
export const clampPct = (pct: number): number => (Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : 0);
