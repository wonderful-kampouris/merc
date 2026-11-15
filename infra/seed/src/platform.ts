// Thin wrapper over `wful call` for the Tables rows API.
import { execFile } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export type Row = Record<string, unknown>;
export interface PRow { id: string; data: Row }

export class Wful {
  private workspace: string; private profile: string;
  constructor(workspace: string, profile: string) { this.workspace = workspace; this.profile = profile; }
  async call(verb: string, path: string, body?: unknown, query: Record<string, string> = {}): Promise<any> {
    const args = ["--profile", this.profile, "--workspace", this.workspace, "call", verb, path, "--raw"];
    for (const [k, v] of Object.entries(query)) args.push("--query", `${k}=${v}`);
    let file: string | undefined;
    if (body !== undefined) {
      file = join(tmpdir(), `merc-seed-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(file, JSON.stringify(body));
      args.push("--data-file", file);
    }
    try {
      const { stdout } = await run("wful", args, { maxBuffer: 64 << 20 });
      return stdout.trim() ? JSON.parse(stdout) : {};
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; message: string };
      throw new Error(`${verb} ${path}: ${(err.stderr || err.stdout || err.message).trim().slice(0, 600)}`);
    } finally { if (file) rmSync(file, { force: true }); }
  }
  async listAll(table: string, filters?: { key: string; operator: string; value: string }[]): Promise<PRow[]> {
    const out: PRow[] = [];
    for (let page = 1; ; page++) {
      const q: Record<string, string> = { limit: "1000", page: String(page) };
      if (filters) q.filters = JSON.stringify({ filters });
      const r = await this.call("get", `/api/v1/custom-tables/${table}/rows`, undefined, q);
      out.push(...(r.data as PRow[]));
      if (!r.pagination?.has_next_page) return out;
    }
  }
  bulkInsert(table: string, rows: Row[]) { return this.call("post", `/api/v1/custom-tables/${table}/rows/bulk`, { rows }); }
  update(table: string, id: string, data: Row) {
    return this.call("put", `/api/v1/custom-tables/${table}/rows/${encodeURIComponent(id)}`, { data });
  }
  deleteIn(table: string, column: string, values: string[]) {
    return this.call("post", `/api/v1/custom-tables/${table}/rows/bulk-delete`,
      { filters: [{ column, operator: "in", value: JSON.stringify(values) }] });
  }
}
