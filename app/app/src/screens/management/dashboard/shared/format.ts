import type { Lang } from "../../../../lib/i18n";

/** Shared formatting for the management screens (dashboard, pipeline, targets, competition). */
export const locale = (lang: Lang): string => (lang === "el" ? "el-GR" : "en-GB");

/** Money is `*_minor` integers in the org currency (EUR), contracts/README.md#units. */
export function money(minor: number | null | undefined, lang: Lang, compact = false): string {
  const v = typeof minor === "number" && Number.isFinite(minor) ? minor / 100 : 0;
  return new Intl.NumberFormat(locale(lang), {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: compact || Math.abs(v) >= 1000 ? 0 : 2,
    notation: compact && Math.abs(v) >= 10000 ? "compact" : "standard",
  }).format(v);
}

export function num(v: number | null | undefined, lang: Lang, digits = 1): string {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: digits }).format(n);
}

/** Percentages are 0-100 in the contracts. */
export const pct = (v: number | null | undefined, lang: Lang): string => `${num(v, lang, 0)}%`;

export function date(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short", year: "numeric" }).format(d);
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
export const numberOr = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
export const stringOr = (v: unknown, fallback = ""): string => str(v) ?? fallback;

/** A readable label for a loosely typed record (`items: object[]` responses). */
export function labelOf(row: Record<string, unknown>, keys: readonly string[] = ["name", "title", "full_name", "account_name", "statement"]): string {
  for (const k of keys) {
    const v = str(row[k]);
    if (v) return v;
  }
  for (const nested of ["account", "rep", "user", "owner"]) {
    const o = row[nested];
    if (o && typeof o === "object") {
      const v = str((o as Record<string, unknown>).name) ?? str((o as Record<string, unknown>).full_name);
      if (v) return v;
    }
  }
  return shortId(row.id);
}

export const shortId = (id: unknown): string => (typeof id === "string" ? `#${id.slice(0, 8)}` : "—");

/** `YYYY-MM-DD` of a Date in local time. */
export const isoDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
