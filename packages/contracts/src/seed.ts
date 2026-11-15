import { seed, seedOrder } from "./generated/seed.js";

export { seedOrder };
export type SeedRow = Record<string, unknown>;

export interface SeedContext {
  /** Demo day; defaults to today (UTC). */
  demoDay?: Date;
  /** Map of `@wuid:<key>` keys to Wonderful user ids; defaults to `wuid-<key>`. */
  wuids?: Record<string, string>;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));

/** Resolve one seed token (`@D-12`, `@D+3@09:30`, `@WEEK_START`, `@MONTH_END`, `@wuid:nikos`). Non-tokens pass through. */
export function resolveToken(value: unknown, ctx: SeedContext = {}): unknown {
  if (typeof value !== "string" || !value.startsWith("@")) return value;
  const day = ctx.demoDay ?? new Date();
  const base = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  let m = /^@D(?:([+-])(\d+))?(?:@(\d{2}):(\d{2}))?$/.exec(value);
  if (m) {
    const d = addDays(base, m[1] ? (m[1] === "-" ? -1 : 1) * Number(m[2]) : 0);
    if (!m[3]) return iso(d);
    d.setUTCHours(Number(m[3]), Number(m[4]));
    return d.toISOString();
  }
  if (value === "@WEEK_START") return iso(addDays(base, -((base.getUTCDay() + 6) % 7)));
  if (value === "@MONTH_START") return iso(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1)));
  if (value === "@MONTH_END") return iso(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)));
  m = /^@wuid:(.+)$/.exec(value);
  if (m) return ctx.wuids?.[m[1]!] ?? `wuid-${m[1]}`;
  return value;
}

/** Seed rows of a table with tokens resolved. Unknown tables return []. */
export function seedRows(table: string, ctx: SeedContext = {}): SeedRow[] {
  return (seed[table] ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, resolveToken(v, ctx)])));
}

export const seedTables = (): string[] => [...seedOrder];

export function seedRowById(table: string, id: unknown, ctx: SeedContext = {}): SeedRow | undefined {
  return seedRows(table, ctx).find((r) => r.id === id);
}
