import { isoDay } from "./format";

export type PeriodPreset = "week" | "month" | "last30" | "quarter";
export const PERIOD_PRESETS: readonly PeriodPreset[] = ["week", "month", "last30", "quarter"];

export interface Period {
  from: string;
  to: string;
}

/** Date range of a preset, ending today (inclusive). Weeks start on Monday (Greek calendar). */
export function periodRange(preset: PeriodPreset, today: Date = new Date()): Period {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let from: Date;
  switch (preset) {
    case "week": {
      const dow = (t.getDay() + 6) % 7; // Mon = 0
      from = new Date(t.getFullYear(), t.getMonth(), t.getDate() - dow);
      break;
    }
    case "month":
      from = new Date(t.getFullYear(), t.getMonth(), 1);
      break;
    case "last30":
      from = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 29);
      break;
    case "quarter":
      from = new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1);
      break;
  }
  return { from: isoDay(from), to: isoDay(t) };
}

/** First and last day of the month `offset` months from today's. */
export function monthRange(offset = 0, today: Date = new Date()): Period {
  const start = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const end = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0);
  return { from: isoDay(start), to: isoDay(end) };
}

/** `from` for "the last N days" filters; null means no lower bound. */
export function daysAgo(n: number | null, today: Date = new Date()): string | null {
  if (n === null) return null;
  return isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
}
