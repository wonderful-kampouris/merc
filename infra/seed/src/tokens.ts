// Seed token resolution (spec/contracts/README.md "Seed tokens"). Pure and deterministic.
export type ColType = "date" | "datetime" | string;
export interface TokenCtx { demoDay: string; tz: string; wuid: Record<string, string> }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REL_RE = /^@D(?:([+-]\d+))?(?:@(\d{2}):(\d{2}))?$/;

export function parseDay(s: string): number {
  if (!DATE_RE.test(s)) throw new Error(`bad date ${s} (want YYYY-MM-DD)`);
  const t = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  if (new Date(t).toISOString().slice(0, 10) !== s) throw new Error(`bad date ${s}`);
  return t;
}
const fmtDay = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => fmtDay(parseDay(day) + n * 86400000);
export function weekStart(day: string): string { // ISO week, Monday
  const dow = new Date(parseDay(day)).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
export function monthEnd(day: string): string {
  const y = +day.slice(0, 4), m = +day.slice(5, 7);
  return fmtDay(Date.UTC(y, m, 0));
}

/** Offset in minutes of tz at the UTC instant t (e.g. +120 for Europe/Athens in winter). */
export function tzOffsetMin(t: number, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - t) / 60000);
}

/** Local wall time on `day` in tz as RFC3339 with the offset valid on that day. */
export function localDateTime(day: string, hh: number, mm: number, tz: string): string {
  const wall = parseDay(day) + (hh * 60 + mm) * 60000;
  let off = tzOffsetMin(wall, tz);
  off = tzOffsetMin(wall - off * 60000, tz); // second pass settles DST edges
  const sign = off < 0 ? "-" : "+", a = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day}T${pad(hh)}:${pad(mm)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export const isToken = (v: unknown): v is string => typeof v === "string" && /^@(D|WEEK_START|MONTH_START|MONTH_END|wuid:)/.test(v);

/** Resolve one token for a column of type `col`. Non-token values are returned unchanged. */
export function resolveToken(v: unknown, ctx: TokenCtx, col: ColType = "date"): unknown {
  if (!isToken(v)) return v;
  if (v.startsWith("@wuid:")) {
    const key = v.slice(6);
    const id = ctx.wuid[key];
    if (!id) throw new Error(`no Wonderful user id for ${v}`);
    return id;
  }
  let day: string, hh = 0, mm = 0, timed = false;
  if (v === "@WEEK_START") day = weekStart(ctx.demoDay);
  else if (v === "@MONTH_START") day = monthStart(ctx.demoDay);
  else if (v === "@MONTH_END") day = monthEnd(ctx.demoDay);
  else {
    const m = REL_RE.exec(v);
    if (!m) throw new Error(`malformed seed token ${v}`);
    day = addDays(ctx.demoDay, m[1] ? parseInt(m[1], 10) : 0);
    if (m[2]) {
      hh = +m[2]; mm = +m[3];
      if (hh > 23 || mm > 59) throw new Error(`bad time in ${v}`);
      timed = true;
    }
  }
  if (col === "datetime") return localDateTime(day, hh, mm, ctx.tz);
  if (col === "date") {
    if (timed) throw new Error(`token ${v} has a time but the column is a date`);
    return day;
  }
  throw new Error(`token ${v} in a ${col} column`);
}

export function resolveRow(row: Record<string, unknown>, types: Record<string, ColType>, ctx: TokenCtx) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    try { out[k] = resolveToken(v, ctx, types[k]); }
    catch (e) { throw new Error(`${k}: ${(e as Error).message}`); }
  }
  return out;
}

/** Today's date in tz (default demo day). */
export function todayIn(tz: string, now = Date.now()): string {
  return fmtDay(now + tzOffsetMin(now, tz) * 60000);
}
