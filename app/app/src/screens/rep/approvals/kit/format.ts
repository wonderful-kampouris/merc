import type { Lang } from "../../../../lib/i18n";

const TZ = "Europe/Athens";
const locale = (lang: Lang): string => (lang === "el" ? "el-GR" : "en-GB");
const dateOnly = (d: string): Date => new Date(`${d.slice(0, 10)}T12:00:00Z`);

/** "Mon 16 Nov" for a `YYYY-MM-DD` date. */
export function formatDay(date: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(dateOnly(date));
}

/** "16 Nov, 09:00" for an ISO date-time, in Athens time. */
export function formatDateTime(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(d);
}

/** `YYYY-MM-DD` plus n days. */
export function addDays(date: string, n: number): string {
  const d = dateOnly(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today's date in Athens as `YYYY-MM-DD`. */
export function getToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
