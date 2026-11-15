// Pure seed planning: contracts -> resolved rows, and the diff against platform rows.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveRow, type ColType, type TokenCtx } from "./tokens.ts";
import type { PRow, Row } from "./platform.ts";

export interface SeedTable { name: string; pk: string; types: Record<string, ColType>; selfRefs: string[]; rows: Row[] }

export function loadSeed(contracts: string, ctx: TokenCtx): SeedTable[] {
  const order = JSON.parse(readFileSync(join(contracts, "seed/_order.json"), "utf8")) as string[];
  return order.map((name) => {
    const c = JSON.parse(readFileSync(join(contracts, `tables/${name}.json`), "utf8")).create as {
      columns: { name: string; type: string; primary_key?: boolean; reference?: { table: string } }[];
    };
    // Platform table payload (WP-INF-03): per-column primary_key, reference.table = "<schema>.<table>".
    const pkCols = c.columns.filter((x) => x.primary_key).map((x) => x.name);
    if (pkCols.length !== 1) throw new Error(`${name}: exactly one primary key column expected`);
    const pk = pkCols[0];
    const types = Object.fromEntries(c.columns.map((x) => [x.name, x.type]));
    const selfRefs = c.columns.filter((x) => x.reference?.table.split(".").pop() === name).map((x) => x.name);
    const raw = JSON.parse(readFileSync(join(contracts, `seed/${name}.json`), "utf8")) as Row[];
    const rows = raw.map((r, i) => {
      for (const k of Object.keys(r)) if (!(k in types)) throw new Error(`${name}[${i}]: unknown column ${k}`);
      if (r[pk] == null) throw new Error(`${name}[${i}]: missing key ${pk}`);
      try { return resolveRow(r, types, ctx); } catch (e) { throw new Error(`${name}[${i}].${(e as Error).message}`); }
    });
    return { name, pk, types, selfRefs, rows };
  });
}

/** Values equal as stored: datetimes compared as instants, null == missing. */
export function sameValue(a: unknown, b: unknown, type: ColType): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (type === "datetime") return Date.parse(String(a)) === Date.parse(String(b));
  if (type === "date") return String(a).slice(0, 10) === String(b).slice(0, 10);
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface Plan { insert: Row[]; update: { id: string; data: Row }[]; same: number }

export function plan(t: SeedTable, existing: PRow[]): Plan {
  const byId = new Map(existing.map((r) => [String(r.data[t.pk] ?? r.id), r]));
  const p: Plan = { insert: [], update: [], same: 0 };
  for (const want of t.rows) {
    const have = byId.get(String(want[t.pk]));
    if (!have) { p.insert.push(want); continue; }
    const changed: Row = {};
    for (const [k, v] of Object.entries(want)) if (k !== t.pk && !sameValue(v, have.data[k], t.types[k])) changed[k] = v;
    if (Object.keys(changed).length) p.update.push({ id: have.id, data: changed }); else p.same++;
  }
  return p;
}

export const chunks = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
