// REQ-CORE-007: dates use the org timezone. "Today", day/week/month ranges and local clock checks are
// computed in organization.timezone, never in the server's zone. Dates are "YYYY-MM-DD" strings (the
// `date` column type); instants are ISO-8601 UTC strings (the `datetime` column type).
// The offset comes from Intl when the runtime has it, else from the runtime's global Moment (Wonderful
// Functions/tools document Moment as the DST-aware clock); tests can inject their own.
import { invalid } from "./errors";

export type Tz = string | { timezone: string };
export type OffsetFn = (tz: string, utcMs: number) => number;
const tzName = (tz: Tz): string => (typeof tz === "string" ? tz : tz.timezone);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function intlOffset(tz: string, utcMs: number): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour! % 24, +p.minute!, +p.second!);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}
function momentOffset(tz: string, utcMs: number): number {
  const M = (globalThis as any).Moment;
  return Number(M.fromTimestamp(BigInt(Math.floor(utcMs))).tz(tz).utcOffset());
}
function defaultOffset(): OffsetFn {
  const hasIntlTz = (() => { try { return typeof Intl !== "undefined" && !!new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Athens" }).formatToParts; } catch { return false; } })();
  if (hasIntlTz) return intlOffset;
  if ((globalThis as any).Moment?.fromTimestamp) return momentOffset;
  throw new Error("no timezone support in this runtime (neither Intl nor Moment)");
}
let offsetFn: OffsetFn | null = null;
/** Tests or exotic runtimes: replace the timezone offset source (null restores auto-detection). */
export function setOffsetSource(fn: OffsetFn | null): void { offsetFn = fn; }
/** Minutes east of UTC for `tz` at the instant `utcMs` (Athens summer = 180). */
export function tzOffsetMinutes(tz: Tz, utcMs: number): number {
  const name = tzName(tz);
  try { return (offsetFn ??= defaultOffset())(name, utcMs); } catch (e) { throw invalid(`unknown timezone ${name}`, { timezone: name, cause: String((e as Error)?.message ?? e) }); }
}

// ---- pure calendar arithmetic on YYYY-MM-DD ---------------------------------------------------
function parseDate(d: string): [number, number, number] {
  const m = DATE_RE.exec(d);
  if (!m) throw invalid(`expected YYYY-MM-DD, got ${d}`);
  const [y, mo, da] = [+m[1]!, +m[2]!, +m[3]!];
  const t = new Date(Date.UTC(y, mo - 1, da));
  if (t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== da) throw invalid(`not a calendar date: ${d}`);
  return [y, mo, da];
}
const fmtUtcDate = (ms: number) => { const t = new Date(ms); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
const dayMs = (d: string) => { const [y, m, da] = parseDate(d); return Date.UTC(y, m - 1, da); };

export const isDate = (d: unknown): d is string => typeof d === "string" && DATE_RE.test(d) && (() => { try { parseDate(d); return true; } catch { return false; } })();
export const addDays = (d: string, n: number): string => fmtUtcDate(dayMs(d) + n * 86_400_000);
/** ISO weekday: Monday = 1 ... Sunday = 7. */
export const weekday = (d: string): number => ((new Date(dayMs(d)).getUTCDay() + 6) % 7) + 1;
/** Whole days from `a` to `b` (b - a). */
export const daysBetween = (a: string, b: string): number => Math.round((dayMs(b) - dayMs(a)) / 86_400_000);
/** The next date on ISO weekday `wd` strictly after `d` ("Thursday" said on a Thursday = next week's). */
export function nextWeekday(d: string, wd: number, opts: { includeToday?: boolean } = {}): string {
  if (!Number.isInteger(wd) || wd < 1 || wd > 7) throw invalid(`weekday must be 1-7, got ${wd}`);
  let diff = (wd - weekday(d) + 7) % 7;
  if (diff === 0 && !opts.includeToday) diff = 7;
  return addDays(d, diff);
}
export const startOfWeek = (d: string): string => addDays(d, 1 - weekday(d));
export const startOfMonth = (d: string): string => `${d.slice(0, 7)}-01`;
export function endOfMonth(d: string): string { const [y, m] = parseDate(d); return fmtUtcDate(Date.UTC(y, m, 0)); }
/** Every date from `from` to `to`, both inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

// ---- org-timezone conversions ------------------------------------------------------------------
export interface LocalParts { date: string; time: string; weekday: number; hour: number; minute: number }
/** Wall-clock date and time in `tz` at instant `at` (default now). */
export function localParts(tz: Tz, at: number | string | Date = Date.now()): LocalParts {
  const ms = typeof at === "number" ? at : typeof at === "string" ? Date.parse(at) : at.getTime();
  if (!Number.isFinite(ms)) throw invalid(`not an instant: ${String(at)}`);
  const local = new Date(ms + tzOffsetMinutes(tz, ms) * 60_000);
  const date = fmtUtcDate(local.getTime());
  return { date, time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`, weekday: weekday(date), hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}
/** Today's date in the org timezone. */
export const today = (tz: Tz, now: number = Date.now()): string => localParts(tz, now).date;
/** Calendar date in `tz` of a stored instant (e.g. a visit's started_at). */
export const localDate = (tz: Tz, instant: string | number): string => localParts(tz, instant).date;

/** The UTC instant (ISO, ms precision) of wall-clock `date time` in `tz`. DST gaps resolve forward. */
export function zonedInstant(tz: Tz, date: string, time = "00:00"): string {
  const t = TIME_RE.exec(time);
  if (!t) throw invalid(`expected HH:MM, got ${time}`);
  const wall = dayMs(date) + (+t[1]! * 60 + +t[2]!) * 60_000;
  let guess = wall - tzOffsetMinutes(tz, wall) * 60_000;
  guess = wall - tzOffsetMinutes(tz, guess) * 60_000; // second pass settles DST boundaries
  return new Date(guess).toISOString();
}

/** Half-open UTC interval [from, to) covering local dates `fromDate`..`toDate` inclusive. */
export interface Range { from: string; to: string; fromDate: string; toDate: string }
export function dateRange(tz: Tz, fromDate: string, toDate: string): Range {
  if (daysBetween(fromDate, toDate) < 0) throw invalid(`range ends before it starts: ${fromDate}..${toDate}`);
  return { from: zonedInstant(tz, fromDate), to: zonedInstant(tz, addDays(toDate, 1)), fromDate, toDate };
}
export const dayRange = (tz: Tz, date: string = today(tz)): Range => dateRange(tz, date, date);
/** Monday-to-Sunday week containing `date` (default: this week in the org timezone). */
export function weekRange(tz: Tz, date: string = today(tz)): Range { const s = startOfWeek(date); return dateRange(tz, s, addDays(s, 6)); }
export function monthRange(tz: Tz, date: string = today(tz)): Range { return dateRange(tz, startOfMonth(date), endOfMonth(date)); }
/** The last `days` local dates ending today (inclusive), e.g. a 30-day window. */
export function lastDaysRange(tz: Tz, days: number, now: number = Date.now()): Range {
  if (!Number.isInteger(days) || days < 1) throw invalid(`days must be a positive integer, got ${days}`);
  const end = today(tz, now);
  return dateRange(tz, addDays(end, 1 - days), end);
}
/** Is the local time in `tz` within [start, end) (HH:MM)? E.g. the 08:00-20:00 call window (REQ-APV-003). */
export function withinLocalHours(tz: Tz, start: string, end: string, at: number | string = Date.now()): boolean {
  for (const x of [start, end]) if (!TIME_RE.test(x)) throw invalid(`expected HH:MM, got ${x}`);
  const t = localParts(tz, at).time;
  return start <= end ? t >= start && t < end : t >= start || t < end;
}
