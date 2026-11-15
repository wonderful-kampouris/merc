// Row snapshots for ai_action.before_snapshot_json / after_snapshot_json (REQ-CORE-006).
// before.rows[i].row === null means the action created that row; undo deletes it.
import { TABLES, conflict, type Db, type Repo, type TableName } from "../../core/src/index";

export const SNAPSHOT_VERSION = 1;
export interface SnapRow { table: TableName; id: string; row: Record<string, unknown> | null }
export interface Snapshot { v: number; rows: SnapRow[] }

const SYSTEM = new Set(["created_at", "updated_at"]);

/** Business columns of a row (system columns dropped, null and missing treated alike). */
export function businessColumns(input: object | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!input) return out;
  const row = input as Record<string, unknown>;
  for (const k of Object.keys(row).sort()) {
    const v = row[k];
    if (SYSTEM.has(k) || v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/**
 * The full stored form of a row for strict equality (REQ-CORE-006 "byte-identical"): every contract column in
 * contract order, a column without a value as null (the platform returns no key for a null column), and
 * created_at kept. Only updated_at is dropped: the platform stamps it on every write and no caller can set it.
 */
export function canonicalRow(table: TableName, input: object | null | undefined): Record<string, unknown> | null {
  if (!input) return null;
  const row = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(TABLES[table].columns)) out[k] = row[k] ?? null;
  out.created_at = row.created_at ?? null;
  return out;
}

export const sameRow = (a: object | null | undefined, b: object | null | undefined) =>
  JSON.stringify(businessColumns(a)) === JSON.stringify(businessColumns(b));

export function repo(db: Db, table: TableName): Repo<TableName> {
  if (!TABLES[table]) throw new Error(`unknown table ${table}`);
  return (db as unknown as Record<string, Repo<TableName>>)[table]!;
}

export const encode = (rows: SnapRow[]): string => JSON.stringify({ v: SNAPSHOT_VERSION, rows } satisfies Snapshot);
export function decode(json: string | null | undefined): Snapshot | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json) as Snapshot;
    return s && s.v === SNAPSHOT_VERSION && Array.isArray(s.rows) ? s : null;
  } catch { return null; }
}

/** The patch that turns `current` back into `before`: changed columns, and null for columns `before` did not have. */
export function restorePatch(table: TableName, before: Record<string, unknown>, current: Record<string, unknown>): Record<string, unknown> {
  const meta = TABLES[table];
  const b = businessColumns(before), c = businessColumns(current);
  const patch: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(c)])) {
    if (k === meta.pk || !meta.columns[k]) continue;
    if (JSON.stringify(b[k]) !== JSON.stringify(c[k])) patch[k] = k in b ? b[k] : null;
  }
  return patch;
}

/**
 * Put the touched rows back to `before`, in reverse order (children before parents).
 * With `after`, a row someone changed since the action fails with conflict before anything is written.
 */
export async function restore(db: Db, before: SnapRow[], after: SnapRow[] | null): Promise<void> {
  const current = new Map<string, Record<string, unknown> | null>();
  for (const s of before) current.set(`${s.table}:${s.id}`, await repo(db, s.table).get(s.id) as Record<string, unknown> | null);
  if (after) {
    for (const a of after) {
      const cur = current.get(`${a.table}:${a.id}`);
      if (cur === undefined) continue;
      if (cur && !sameRow(cur, a.row)) throw conflict(`${a.table} ${a.id} was changed after the AI action; undo it by hand`, { table: a.table, id: a.id });
    }
  }
  for (const s of [...before].reverse()) {
    const cur = current.get(`${s.table}:${s.id}`) ?? null;
    if (s.row === null) { if (cur) await repo(db, s.table).delete(s.id); continue; }
    if (!cur) throw conflict(`${s.table} ${s.id} no longer exists; cannot restore it`, { table: s.table, id: s.id });
    const patch = restorePatch(s.table, s.row, cur);
    if (Object.keys(patch).length) await repo(db, s.table).update(s.id, patch as never);
  }
}
