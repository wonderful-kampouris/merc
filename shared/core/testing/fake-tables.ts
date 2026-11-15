// In-memory stand-in for context.tables, mimicking the platform behaviour measured in S9:
// FK miss -> 400, restrict delete -> 400, unique violation -> 500, missing row -> 404.
// Test-only (not published to shared_lib): used by @merc/core tests and @merc/handlers src/_lib.
import { randomUUID } from "node:crypto";
import { TABLES, TABLE_ORDER, type TableName } from "../src/generated/tables";
import { testFilter, type Filter, type OrderBy, type RowEnvelope, type TablesApi } from "../src/tables";
import { seedRows } from "../../../packages/contracts/src/seed";

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const short = (q: string) => q.toLowerCase().replace(/^merc\./, "") as TableName;

export class FakeTables implements TablesApi {
  readonly rows = new Map<TableName, Map<string, Record<string, any>>>();
  readonly calls: string[] = [];
  /** Test hook: make the next write throw this error instead of running (e.g. a bare 500). */
  failNextWrite: Error | null = null;

  private t(q: string): Map<string, Record<string, any>> {
    const n = short(q);
    if (!TABLES[n]) throw httpError(404, `table ${q} not found`);
    let m = this.rows.get(n);
    if (!m) this.rows.set(n, (m = new Map()));
    return m;
  }
  private env(q: string, r: Record<string, any>): RowEnvelope { return { id: String(r[TABLES[short(q)].pk]), data: { ...r } }; }
  private injected(): void {
    const e = this.failNextWrite;
    if (e) { this.failNextWrite = null; throw e; }
  }

  /** Load rows directly (no checks), as the seed loader does. */
  load(table: TableName, rows: Record<string, any>[]): void {
    const m = this.t(table);
    for (const r of rows) m.set(String(r[TABLES[table].pk]), { ...r, created_at: 0, updated_at: 0 });
  }

  private checkWrite(q: string, row: Record<string, any>, selfId: string | null): void {
    const meta = TABLES[short(q)];
    for (const [col, c] of Object.entries(meta.columns)) {
      if (!c.ref || row[col] === null || row[col] === undefined) continue;
      if (!this.t(c.ref.table).has(String(row[col]))) throw httpError(400, `column '${col}' must reference an existing row in 'merc.${c.ref.table}'`);
    }
    for (const cols of meta.unique) {
      if (cols.some((c) => row[c] === null || row[c] === undefined)) continue;
      for (const [id, other] of this.t(q)) if (id !== selfId && cols.every((c) => other[c] === row[c])) throw httpError(500, "Internal server error");
    }
  }

  async getRow(q: string, id: string) {
    this.calls.push(`getRow ${q}`);
    const r = this.t(q).get(id);
    if (!r) throw httpError(404, "row not found");
    return this.env(q, r);
  }
  async filter(q: string, filters: Filter[], limit = 100, offset = 0, orderBy?: OrderBy) {
    this.calls.push(`filter ${q} ${JSON.stringify(filters)}`);
    let all = [...this.t(q).values()].filter((r) => filters.every((f) => testFilter(r, f)));
    const ob = orderBy?.length ? orderBy : [{ column: "created_at", direction: "desc" as const }];
    all = all.sort((a, b) => {
      for (const o of ob) {
        const x = a[o.column], y = b[o.column];
        if (x === y) continue;
        return (x < y ? -1 : 1) * (o.direction === "desc" ? -1 : 1);
      }
      return 0;
    });
    return { rows: all.slice(offset, offset + limit).map((r) => this.env(q, r)), total: all.length };
  }
  async count(q: string, filters: Filter[] = []) {
    return (await this.filter(q, filters, 1_000_000)).total;
  }
  async insert(q: string, data: Record<string, any>) {
    this.calls.push(`insert ${q}`);
    this.injected();
    const meta = TABLES[short(q)];
    const row = { ...data };
    if (meta.pkAuto && !row[meta.pk]) row[meta.pk] = randomUUID();
    this.checkWrite(q, row, null);
    const now = Date.now();
    this.t(q).set(String(row[meta.pk]), { ...row, created_at: now, updated_at: now });
    return this.env(q, this.t(q).get(String(row[meta.pk]))!);
  }
  async update(q: string, id: string, data: Record<string, any>) {
    this.calls.push(`update ${q}`);
    this.injected();
    const cur = this.t(q).get(id);
    if (!cur) throw httpError(404, "row not found");
    const next = { ...cur, ...data, updated_at: Date.now() };
    this.checkWrite(q, next, id);
    this.t(q).set(id, next);
    return this.env(q, next);
  }
  async deleteRow(q: string, id: string) {
    this.calls.push(`deleteRow ${q}`);
    const name = short(q);
    if (!this.t(q).has(id)) throw httpError(404, "row not found");
    for (const [other, meta] of Object.entries(TABLES)) {
      for (const [col, c] of Object.entries(meta.columns)) {
        if (c.ref?.table !== name || c.ref.on_delete !== "restrict") continue;
        for (const r of this.t(other).values()) if (r[col] === id) throw httpError(400, "cannot delete: rows in another table still reference it");
      }
    }
    this.t(q).delete(id);
  }
}

/** The deterministic demo day the seeded fake uses (seed tokens like @D resolve against it). */
export const DEMO_DAY = "2026-11-16";

/** A fake loaded with the full deterministic demo seed (wuid tokens resolve to `wuid-<key>`). */
export function seeded(): FakeTables {
  const f = new FakeTables();
  for (const t of TABLE_ORDER) f.load(t, seedRows(t, { demoDay: new Date(`${DEMO_DAY}T00:00:00Z`) }) as Record<string, any>[]);
  return f;
}

export const IDS = {
  org: "97ee94d2-794c-5d47-923d-5616221c9835",
  thanasis: "bcc2830f-a618-5ab1-bb5c-46707c21a9e6", // admin
  eleni: "fa4c7746-c253-5104-a735-7060bfddb756", // manager
  nikos: "d72bccf8-f36c-5abf-8d0d-142783f090cd", // rep, North
  dimitra: "a3ecd990-28ac-57dd-9d89-c5e5afb1f68c", // rep, North
  center_rep: "27f8d8e3-7f84-5b9f-90e1-7d3fab3d9b22", // rep, Center
  north: "76b55561-9135-5c55-ad43-34661bffd9d9",
  center: "ab0e35fb-6fcb-5d04-aa2b-36be2cc7372c",
  miltos: "59b5e454-cc4b-5fab-939b-a50c78e8aa9b",
};
export const fnCtx = (wuid: string | null, data: unknown = {}) => ({ metadata: wuid ? { user: { id: wuid, email: "x@y", role: "user", tenantId: "t" } } : {}, data });
