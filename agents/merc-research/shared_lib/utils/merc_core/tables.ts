// Typed CRUD per contract table over context.tables (schema `merc`), with automatic org filtering,
// write validation (types, enums, REQ-CORE-007 units), unique pre-checks and platform-error mapping.
import { TABLES, MERC_SCHEMA, type TableName, type TableRows, type TableInserts, type TableMeta } from "./generated/tables";
import { MercError, conflict, forbidden, invalid, notFound } from "./errors";
import { unitErrors } from "./validate";

export interface RowEnvelope { id: string; data: Record<string, any> }
export type FilterOp = "eq" | "neq" | "contains" | "starts_with" | "ends_with" | "gt" | "gte" | "lt" | "lte" | "in" | "is_null" | "is_not_null";
export interface Filter { column: string; operator: FilterOp; value?: unknown }
export type OrderBy = Array<{ column: string; direction?: "asc" | "desc" }>;

/** The subset of the platform `context.tables` this lib uses (structurally compatible). */
export interface TablesApi {
  getRow(table: string, id: string): Promise<RowEnvelope>;
  filter(table: string, filters: Filter[], limit?: number, offset?: number, orderBy?: OrderBy): Promise<{ rows: RowEnvelope[]; total: number }>;
  insert(table: string, data: Record<string, any>): Promise<RowEnvelope>;
  update(table: string, id: string, data: Record<string, any>): Promise<RowEnvelope>;
  deleteRow(table: string, id: string): Promise<void>;
  count(table: string, filters?: Filter[]): Promise<number>;
}

export type Row<N extends TableName> = TableRows[N] & { created_at?: number; updated_at?: number };
export type Cond<V> = V | null | readonly V[] | { op: FilterOp; value?: unknown };
export type Where<N extends TableName> = { [K in keyof TableRows[N]]?: Cond<NonNullable<TableRows[N][K]>> };
export interface ListOpts<N extends TableName> {
  limit?: number;
  offset?: number;
  orderBy?: Array<{ column: (keyof TableRows[N] & string) | "created_at" | "updated_at"; direction?: "asc" | "desc" }>;
  /** Extra raw filters ANDed with `where` (scope sets use this so a caller's own condition on the same column is kept). */
  and?: Filter[];
}
export interface Page<T> { items: T[]; total: number }

const SYSTEM = new Set(["created_at", "updated_at"]);
const isOp = (v: unknown): v is { op: FilterOp; value?: unknown } => typeof v === "object" && v !== null && !Array.isArray(v) && "op" in v;

export function toFilters(where: Record<string, unknown>): Filter[] {
  const out: Filter[] = [];
  for (const [column, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (v === null) out.push({ column, operator: "is_null" });
    else if (Array.isArray(v)) out.push({ column, operator: "in", value: [...v] });
    else if (isOp(v)) out.push({ column, operator: v.op, value: v.value });
    else out.push({ column, operator: "eq", value: v });
  }
  return out;
}

/** In-memory evaluation of one filter with the platform's semantics (contains is case-insensitive). */
export function testFilter(row: Record<string, unknown>, f: Filter): boolean {
  const v = row[f.column] as any, x = f.value as any;
  switch (f.operator) {
    case "eq": return v === x;
    case "neq": return v !== x;
    case "in": return Array.isArray(x) && x.includes(v);
    case "is_null": return v === null || v === undefined;
    case "is_not_null": return v !== null && v !== undefined;
    case "gt": return v !== null && v !== undefined && v > x;
    case "gte": return v !== null && v !== undefined && v >= x;
    case "lt": return v !== null && v !== undefined && v < x;
    case "lte": return v !== null && v !== undefined && v <= x;
    case "contains": return String(v ?? "").toLowerCase().includes(String(x).toLowerCase());
    case "starts_with": return String(v ?? "").startsWith(String(x));
    case "ends_with": return String(v ?? "").endsWith(String(x));
  }
}

/** In-memory match of a `where` object, including op conditions ({op, value}). */
export function matches(rowObj: object, whereObj: object): boolean {
  const row = rowObj as Record<string, unknown>;
  return toFilters(whereObj as Record<string, unknown>).every((f) => testFilter(row, f));
}

/** Validate a write against the table contract. Throws validation_failed with all problems listed. */
export function checkRow(meta: TableMeta, data: Record<string, unknown>, mode: "insert" | "update"): void {
  const errors: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (SYSTEM.has(k) || v === undefined) continue;
    const col = meta.columns[k];
    if (!col) { errors.push(`${k}: unknown column`); continue; }
    if (v === null) { if (col.required) errors.push(`${k}: required`); continue; }
    switch (col.type) {
      case "string": case "auto_uuid": if (typeof v !== "string") errors.push(`${k}: expected string`); break;
      case "date": if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors.push(`${k}: expected YYYY-MM-DD`); break;
      case "datetime": if (typeof v !== "string" || Number.isNaN(Date.parse(v))) errors.push(`${k}: expected ISO datetime`); break;
      case "number": if (typeof v !== "number" || !Number.isFinite(v)) errors.push(`${k}: expected number`); else errors.push(...unitErrors(k, v, k)); break;
      case "boolean": if (typeof v !== "boolean") errors.push(`${k}: expected boolean`); break;
    }
    if (col.enum && !col.enum.includes(v as string)) errors.push(`${k}: must be one of ${col.enum.join(", ")}`);
  }
  if (mode === "insert") {
    for (const [k, col] of Object.entries(meta.columns)) {
      if (col.required && !(k === meta.pk && meta.pkAuto) && (data[k] === undefined || data[k] === null)) errors.push(`${k}: required`);
    }
  }
  if (errors.length) throw invalid(`invalid ${meta.name}: ${errors.slice(0, 3).join("; ")}`, { table: meta.name, errors: [...new Set(errors)] });
}

const statusOf = (e: any): number | undefined => e?.status ?? e?.statusCode ?? e?.response?.status;
const msgOf = (e: any): string => String(e?.message ?? e);
const isMissing = (e: unknown) => statusOf(e) === 404 || /not found|no rows|does not exist/i.test(msgOf(e));

/**
 * Map platform table errors (seen in S9) to stable Error codes. A bare 500 is upstream_failed here:
 * the platform also answers 500 for a unique clash, but only Repo.insert/update may turn it into
 * `conflict`, after re-reading the unique keys and finding the clashing row (confirmUniqueClash).
 */
export function mapTableError(e: unknown, meta: TableMeta, op: "get" | "list" | "insert" | "update" | "delete" | "count"): MercError {
  if (e instanceof MercError) return e;
  const msg = msgOf(e), status = statusOf(e);
  const details = { table: meta.name, op };
  if ((e as any)?.name === "TableTimeoutError" || /timed? ?out/i.test(msg)) return new MercError("timeout", `${meta.name} ${op} timed out`, details);
  if (/must reference an existing row/i.test(msg)) return invalid(msg, details);
  if (/still reference/i.test(msg)) return conflict(msg, details);
  if (/duplicate key|unique constraint|unique violation|already exists/i.test(msg)) return conflict(`${meta.name} already exists`, details);
  if (isMissing(e)) return notFound(`${meta.name} not found`, details);
  return new MercError("upstream_failed", msg, { ...details, ...(status ? { status } : {}) });
}

export class Repo<N extends TableName> {
  readonly meta: TableMeta;
  readonly qualified: string;
  constructor(private readonly api: TablesApi, readonly name: N, readonly orgId: string | null) {
    this.meta = TABLES[name];
    this.qualified = `${this.meta.schema ?? MERC_SCHEMA}.${name}`;
  }

  private scoped(filters: Filter[]): Filter[] {
    return this.meta.orgScoped && this.orgId ? [...filters, { column: "org_id", operator: "eq", value: this.orgId }] : filters;
  }
  private row(env: RowEnvelope): Row<N> {
    return { ...env.data, [this.meta.pk]: env.data[this.meta.pk] ?? env.id } as Row<N>;
  }
  private inOrg(r: object): boolean {
    return !this.meta.orgScoped || !this.orgId || (r as { org_id?: unknown }).org_id === this.orgId;
  }

  /** Row by primary key, or null if missing or in another org. */
  async get(id: string): Promise<Row<N> | null> {
    let env: RowEnvelope | null | undefined;
    try { env = await this.api.getRow(this.qualified, id); } catch (e) { if (isMissing(e)) return null; throw mapTableError(e, this.meta, "get"); }
    if (!env) return null;
    const r = this.row(env);
    return this.inOrg(r) ? r : null;
  }

  async require(id: string): Promise<Row<N>> {
    const r = await this.get(id);
    if (!r) throw notFound(`${this.name} not found`, { table: this.name, id });
    return r;
  }

  async list(where: Where<N> = {}, opts: ListOpts<N> = {}): Promise<Page<Row<N>>> {
    const filters = [...toFilters(where as Record<string, unknown>), ...(opts.and ?? [])];
    if (filters.some((f) => f.operator === "in" && Array.isArray(f.value) && f.value.length === 0)) return { items: [], total: 0 };
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    try {
      const res = await this.api.filter(this.qualified, this.scoped(filters), limit, opts.offset ?? 0, opts.orderBy);
      return { items: res.rows.map((r) => this.row(r)), total: res.total };
    } catch (e) { throw mapTableError(e, this.meta, "list"); }
  }

  /** Every matching row (pages of 1000, capped). */
  async all(where: Where<N> = {}, opts: Omit<ListOpts<N>, "limit" | "offset"> & { cap?: number } = {}): Promise<Row<N>[]> {
    const cap = opts.cap ?? 5000;
    const out: Row<N>[] = [];
    for (let offset = 0; offset < cap; offset += 1000) {
      const page = await this.list(where, { ...opts, limit: 1000, offset });
      out.push(...page.items);
      if (page.items.length < 1000 || out.length >= page.total) break;
    }
    return out.slice(0, cap);
  }

  async findOne(where: Where<N>): Promise<Row<N> | null> {
    return (await this.list(where, { limit: 1 })).items[0] ?? null;
  }

  async count(where: Where<N> = {}): Promise<number> {
    try { return await this.api.count(this.qualified, this.scoped(toFilters(where as Record<string, unknown>))); } catch (e) { throw mapTableError(e, this.meta, "count"); }
  }

  /** The first unique index whose values another row already holds, or null. */
  private async uniqueClash(row: Record<string, unknown>, selfId: string | null, changed?: Set<string>): Promise<string[] | null> {
    for (const cols of this.meta.unique) {
      if (changed && !cols.some((c) => changed.has(c))) continue;
      if (cols.some((c) => row[c] === undefined || row[c] === null)) continue;
      const res = await this.api.filter(this.qualified, cols.map((c) => ({ column: c, operator: "eq" as const, value: row[c] })), 2, 0);
      if (res.rows.some((r) => this.row(r)[this.meta.pk as keyof Row<N>] !== selfId)) return cols;
    }
    return null;
  }
  private async precheckUnique(row: Record<string, unknown>, selfId: string | null, changed?: Set<string>): Promise<void> {
    const cols = await this.uniqueClash(row, selfId, changed);
    if (cols) throw conflict(`${this.name} already exists (${cols.join(", ")})`, { table: this.name, columns: cols });
  }
  /** A write failed: a 500 becomes `conflict` only if a re-read confirms the unique clash (lost race); else the mapped error. */
  private async writeError(e: unknown, row: Record<string, unknown>, selfId: string | null, op: "insert" | "update"): Promise<MercError> {
    if (statusOf(e) === 500 && this.meta.unique.length > 0) {
      let cols: string[] | null = null;
      try { cols = await this.uniqueClash(row, selfId); } catch { cols = null; }
      if (cols) return conflict(`${this.name} already exists (${cols.join(", ")})`, { table: this.name, columns: cols, confirmed_after: 500 });
    }
    return mapTableError(e, this.meta, op);
  }

  async insert(data: TableInserts[N]): Promise<Row<N>> {
    const d: Record<string, unknown> = { ...(data as Record<string, unknown>) };
    if (this.meta.orgScoped && this.orgId) {
      if (d.org_id && d.org_id !== this.orgId) throw forbidden(`cannot write ${this.name} of another org`);
      d.org_id = this.orgId;
    }
    for (const k of SYSTEM) delete d[k];
    checkRow(this.meta, d, "insert");
    await this.precheckUnique(d, null);
    try { return this.row(await this.api.insert(this.qualified, d)); } catch (e) { throw await this.writeError(e, d, null, "insert"); }
  }

  async update(id: string, patch: Partial<TableRows[N]>): Promise<Row<N>> {
    const p: Record<string, unknown> = { ...(patch as Record<string, unknown>) };
    for (const k of SYSTEM) delete p[k];
    const current = await this.require(id);
    if (p[this.meta.pk] !== undefined && p[this.meta.pk] !== id) throw invalid(`cannot change ${this.name}.${this.meta.pk}`);
    if (this.meta.orgScoped && p.org_id !== undefined && p.org_id !== (current as unknown as { org_id?: unknown }).org_id) throw forbidden(`cannot move ${this.name} to another org`);
    delete p[this.meta.pk];
    checkRow(this.meta, p, "update");
    await this.precheckUnique({ ...current, ...p }, id, new Set(Object.keys(p)));
    try { return this.row(await this.api.update(this.qualified, id, p)); } catch (e) { throw await this.writeError(e, { ...current, ...p }, id, "update"); }
  }

  async delete(id: string): Promise<void> {
    await this.require(id);
    try { await this.api.deleteRow(this.qualified, id); } catch (e) { throw mapTableError(e, this.meta, "delete"); }
  }
}

export type Db = { readonly [N in TableName]: Repo<N> } & { readonly orgId: string | null; readonly api: TablesApi; withOrg(orgId: string): Db };

/** One typed repo per contract table. With orgId, org-scoped tables are filtered and stamped with it. */
export function createDb(api: TablesApi, orgId: string | null = null): Db {
  const db: Record<string, unknown> = { orgId, api, withOrg: (o: string) => createDb(api, o) };
  for (const n of Object.keys(TABLES) as TableName[]) {
    let repo: Repo<TableName> | undefined;
    Object.defineProperty(db, n, { enumerable: true, get: () => (repo ??= new Repo(api, n, orgId)) });
  }
  return db as Db;
}
