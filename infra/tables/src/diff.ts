import type { PlatformColumn, PlatformIndex, PlatformTable } from "./types.ts";

export interface TableDiff {
  missingColumns: string[];
  missingRefs: string[];
  missingIndexes: string[];
  /** Existing columns/indexes that differ from the contract. Never auto-fixed (could lose data). */
  drift: string[];
  /** Columns present on the platform but not in the contract. Preserved on update. */
  extraColumns: string[];
}

const normRef = (r?: { table: string; on_delete?: string }) =>
  r ? `${r.table}|${r.on_delete ?? "restrict"}` : "";
const normIdx = (i: PlatformIndex) => `${i.columns.join(",")}|${i.unique ? "u" : ""}|${i.type ?? "btree"}`;

export function diffTable(desired: PlatformTable, existing: PlatformTable): TableDiff {
  const d: TableDiff = { missingColumns: [], missingRefs: [], missingIndexes: [], drift: [], extraColumns: [] };
  const ex = new Map(existing.columns.map((c) => [c.name, c]));
  for (const c of desired.columns) {
    const e = ex.get(c.name);
    if (!e) { d.missingColumns.push(c.name); continue; }
    if (e.type !== c.type) d.drift.push(`${c.name}: type ${e.type} != ${c.type}`);
    if (Boolean(e.required) !== Boolean(c.required)) d.drift.push(`${c.name}: required ${e.required} != ${c.required}`);
    if (Boolean(e.primary_key) !== Boolean(c.primary_key)) d.drift.push(`${c.name}: primary_key ${e.primary_key} != ${c.primary_key}`);
    if (c.reference && !e.reference) d.missingRefs.push(c.name);
    else if (e.reference && normRef(e.reference) !== normRef(c.reference)) {
      d.drift.push(`${c.name}: reference ${normRef(e.reference)} != ${normRef(c.reference) || "none"}`);
    }
  }
  const want = new Set(desired.columns.map((c) => c.name));
  d.extraColumns = existing.columns.map((c) => c.name).filter((n) => !want.has(n));
  const exi = new Map((existing.indexes ?? []).map((i) => [i.name, i]));
  for (const i of desired.indexes) {
    const e = exi.get(i.name);
    if (!e) d.missingIndexes.push(i.name);
    else if (normIdx(e) !== normIdx(i)) d.drift.push(`index ${i.name}: ${normIdx(e)} != ${normIdx(i)}`);
  }
  return d;
}

export const needsUpdate = (d: TableDiff) =>
  d.missingColumns.length + d.missingRefs.length + d.missingIndexes.length > 0;

/** Update body: desired columns plus any extra platform columns (kept as-is), all desired + extra indexes. */
export function updateBody(desired: PlatformTable, existing: PlatformTable): Pick<PlatformTable, "columns" | "indexes"> {
  const want = new Set(desired.columns.map((c) => c.name));
  const extra: PlatformColumn[] = existing.columns.filter((c) => !want.has(c.name));
  const wantIdx = new Set(desired.indexes.map((i) => i.name));
  const extraIdx = (existing.indexes ?? []).filter((i) => !wantIdx.has(i.name));
  return { columns: [...desired.columns, ...extra], indexes: [...desired.indexes, ...extraIdx] };
}
