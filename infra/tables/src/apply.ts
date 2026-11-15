// Applies schema merc from spec/contracts/tables in _order.json order. Idempotent.
// The contract create blocks are the platform payload and are sent unchanged.
// --dry-run reads the platform and prints what would change, without writing anything.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { diffTable, needsUpdate, updateBody } from "./diff.ts";
import { phase1, validateShape } from "./payload.ts";
import type { ContractTable, DeferredRef, PlatformTable } from "./types.ts";

const run = promisify(execFile);

export interface Opts { workspace: string; profile: string; contracts: string; out: string; dryRun: boolean }

export class Wful {
  private o: Pick<Opts, "workspace" | "profile">;
  constructor(o: Pick<Opts, "workspace" | "profile">) { this.o = o; }
  async exec(args: string[]): Promise<string> {
    const full = ["--profile", this.o.profile, "--workspace", this.o.workspace, ...args];
    try {
      const { stdout } = await run("wful", full, { maxBuffer: 32 << 20 });
      return stdout;
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; message: string };
      throw new Error(`wful ${args.join(" ")}: ${(err.stderr || err.stdout || err.message).trim()}`);
    }
  }
  async get(qualified: string): Promise<PlatformTable | null> {
    try {
      return JSON.parse(await this.exec(["tables", "get", qualified, "--json"])) as PlatformTable;
    } catch (e) {
      if (/\(404\)|not found/i.test((e as Error).message)) return null;
      throw e;
    }
  }
  /** Writes the body to a private temp dir, runs f, and always removes the dir. */
  private async withFile(body: unknown, f: (p: string) => Promise<string>): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "merc-tables-"));
    try {
      const p = join(dir, "body.json");
      writeFileSync(p, JSON.stringify(body));
      return await f(p);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  create(t: PlatformTable) { return this.withFile(t, (p) => this.exec(["tables", "create", "--data-file", p, "--json"])); }
  update(qualified: string, body: unknown) {
    return this.withFile(body, (p) => this.exec(["tables", "update", qualified, "--data-file", p, "--json"]));
  }
}

export interface Platform {
  get(qualified: string): Promise<PlatformTable | null>;
  create(t: PlatformTable): Promise<unknown>;
  update(qualified: string, body: unknown): Promise<unknown>;
}

export function loadContracts(dir: string) {
  const order = JSON.parse(readFileSync(join(dir, "_order.json"), "utf8")) as { order: string[]; deferred_self_refs: DeferredRef[] };
  const tables = order.order.map((n) => (JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8")) as { create: ContractTable }).create);
  return { order, tables };
}

export type Counts = { created: number; updated: number; unchanged: number; drift: number; failed: number; deferredAdded: number };

export async function applyAll(
  w: Platform, tables: ContractTable[], deferred: DeferredRef[], dryRun: boolean, say: (s: string) => void,
): Promise<Counts> {
  const counts: Counts = { created: 0, updated: 0, unchanged: 0, drift: 0, failed: 0, deferredAdded: 0 };
  const dry = dryRun ? " (dry-run)" : "";
  const created = new Set<string>();

  const shape = tables.flatMap(validateShape);
  if (shape.length) {
    for (const s of shape) say(`FAIL     shape ${s}`);
    counts.failed += shape.length;
    return counts;
  }

  // Phase 1: create in order (deferred self-refs omitted), add missing columns/indexes/FKs.
  for (const t of tables) {
    const q = `${t.schema}.${t.name}`;
    const want = phase1(t, deferred);
    try {
      const ex = await w.get(q);
      if (!ex) {
        if (!dryRun) await w.create(want);
        created.add(t.name);
        counts.created++; say(`create   ${q}${dry}`);
        continue;
      }
      const d = diffTable(want, ex);
      if (d.drift.length) { counts.drift++; say(`DRIFT    ${q}: ${d.drift.join("; ")}`); }
      if (needsUpdate(d)) {
        if (!dryRun) await w.update(q, updateBody(want, ex));
        counts.updated++;
        say(`update   ${q}: +cols[${d.missingColumns}] +fks[${d.missingRefs}] +idx[${d.missingIndexes}]${dry}`);
      } else if (!d.drift.length) { counts.unchanged++; say(`ok       ${q}`); }
    } catch (e) { counts.failed++; say(`FAIL     ${q}: ${(e as Error).message}`); }
  }

  // Phase 2: deferred self-references.
  for (const r of deferred) {
    const t = tables.find((x) => x.name === r.table);
    if (!t) { counts.failed++; say(`FAIL     deferred ${r.table}.${r.column}: unknown table`); continue; }
    const q = `${t.schema}.${t.name}`;
    try {
      const ex = dryRun && created.has(t.name) ? phase1(t, deferred) : await w.get(q);
      if (!ex) throw new Error("table missing after phase 1");
      const d = diffTable(t, ex);
      if (d.missingRefs.includes(r.column) || d.missingColumns.includes(r.column) || d.missingIndexes.length) {
        if (!dryRun) await w.update(q, updateBody(t, ex));
        counts.deferredAdded++;
        say(`fk       ${q}.${r.column} -> ${t.columns.find((c) => c.name === r.column)?.reference?.table}${dry}`);
      } else say(`ok       ${q}.${r.column} (self-ref present)`);
    } catch (e) { counts.failed++; say(`FAIL     deferred ${q}.${r.column}: ${(e as Error).message}`); }
  }
  return counts;
}

export async function main(o: Opts): Promise<number> {
  const { order, tables } = loadContracts(o.contracts);
  const log: string[] = [];
  const say = (s: string) => { log.push(s); console.log(s); };
  const counts = await applyAll(new Wful(o), tables, order.deferred_self_refs, o.dryRun, say);
  say(`summary${o.dryRun ? " (dry-run, nothing written)" : ""}: ${JSON.stringify(counts)}`);
  mkdirSync(o.out, { recursive: true });
  writeFileSync(join(o.out, o.dryRun ? "last-dry-run.log" : "last-run.log"), log.join("\n") + "\n");
  return counts.failed || counts.drift ? 1 : 0;
}

function parseArgs(argv: string[]): Opts {
  const here = resolve(import.meta.dirname, "..");
  const o: Opts = {
    workspace: "", profile: "hackathon", dryRun: false,
    contracts: resolve(here, "../../spec/contracts/tables"), out: resolve(here, "out"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => { const x = argv[++i]; if (!x) throw new Error(`${a} needs a value`); return x; };
    if (a === "--workspace") o.workspace = v();
    else if (a === "--profile") o.profile = v();
    else if (a === "--contracts") o.contracts = resolve(v());
    else if (a === "--out") o.out = resolve(v());
    else if (a === "--dry-run") o.dryRun = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.workspace) throw new Error("--workspace <id> is required (dry-run reads the platform too)");
  return o;
}

if (import.meta.filename === resolve(process.argv[1] ?? "")) {
  main(parseArgs(process.argv.slice(2))).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(2); });
}
