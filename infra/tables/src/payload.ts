import type { ContractTable, DeferredRef, PlatformTable } from "./types.ts";

export const MAX_INDEX_NAME = 49;
const TABLE_KEYS = new Set(["schema", "name", "description", "columns", "indexes"]);
const COLUMN_KEYS = new Set(["name", "type", "required", "primary_key", "reference", "enum_values", "default_value"]);
const INDEX_KEYS = new Set(["name", "columns", "unique", "type"]);

/**
 * Checks that a contract create block already is the verified platform payload. No translation
 * happens here: a legacy shape (top-level primary_key, `references`, index `method`, long names)
 * is an error that points at spec/_build/build.py.
 */
export function validateShape(t: ContractTable): string[] {
  const e: string[] = [];
  const bad = (m: string) => e.push(`${t.name}: ${m}`);
  for (const k of Object.keys(t)) if (!TABLE_KEYS.has(k)) bad(`unexpected key ${k}`);
  if (!t.schema) bad("missing schema");
  const pks = t.columns.filter((c) => c.primary_key).map((c) => c.name);
  if (pks.length !== 1) bad(`expected exactly one primary_key column, got [${pks}]`);
  for (const c of t.columns) {
    for (const k of Object.keys(c)) if (!COLUMN_KEYS.has(k)) bad(`column ${c.name}: unexpected key ${k}`);
    if (c.reference && !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(c.reference.table)) bad(`column ${c.name}: reference not schema-qualified`);
  }
  for (const i of t.indexes ?? []) {
    for (const k of Object.keys(i)) if (!INDEX_KEYS.has(k)) bad(`index ${i.name}: unexpected key ${k}`);
    if (i.name.length > MAX_INDEX_NAME) bad(`index ${i.name}: name > ${MAX_INDEX_NAME} chars`);
  }
  return e;
}

/**
 * Phase-1 payload: the contract payload minus deferred self-references (the column and any index
 * on it). The platform rejects a FK to the table being created and a non-PK auto_uuid column
 * without a FK; phase 2 adds both with an update.
 */
export function phase1(t: ContractTable, deferred: DeferredRef[] = []): PlatformTable {
  const isDeferred = (col: string) => deferred.some((d) => d.table === t.name && d.column === col);
  if (!deferred.some((d) => d.table === t.name)) return t;
  return {
    ...t,
    columns: t.columns.filter((c) => !isDeferred(c.name)),
    indexes: (t.indexes ?? []).filter((i) => !i.columns.some(isDeferred)),
  };
}
