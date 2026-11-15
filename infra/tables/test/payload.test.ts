import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { MAX_INDEX_NAME, phase1, validateShape } from "../src/payload.ts";
import { diffTable, needsUpdate, updateBody } from "../src/diff.ts";
import { Wful, applyAll, loadContracts, type Platform } from "../src/apply.ts";
import type { ContractTable, PlatformTable } from "../src/types.ts";

const CONTRACTS = resolve(import.meta.dirname, "../../../spec/contracts/tables");
const { order, tables } = loadContracts(CONTRACTS);
const byName = new Map(tables.map((t) => [t.name, t]));

// The WP-INF-01 index shortener that created the names now on dev. build.py must emit the same names.
function inf01ShortName(name: string): string {
  if (name.length <= MAX_INDEX_NAME) return name;
  const suffix = /(_uq|_idx|_gin)$/.exec(name)?.[1] ?? "";
  const hash = createHash("sha1").update(name).digest("hex").slice(0, 8);
  return `${name.slice(0, MAX_INDEX_NAME - suffix.length - hash.length - 1).replace(/_+$/, "")}_${hash}${suffix}`;
}

test("every contract create block is the verified platform payload", () => {
  assert.equal(tables.length, 64);
  const seen = new Set<string>();
  for (const t of tables) {
    assert.deepEqual(validateShape(t), [], t.name);
    assert.equal(t.schema, "merc");
    assert.ok(!("primary_key" in t), `${t.name}: no top-level primary_key`);
    assert.equal(t.columns.filter((c) => c.primary_key).length, 1, t.name);
    assert.ok(t.columns.length <= 50 && t.indexes.length <= 10, t.name);
    for (const c of t.columns) {
      assert.ok(!("references" in c), `${t.name}.${c.name}: legacy references`);
      if (!c.reference) continue;
      assert.match(c.reference.table, /^merc\.[a-z0-9_]+$/);
      assert.ok(c.reference.on_delete, `${t.name}.${c.name}: on_delete`);
      const target = byName.get(c.reference.table.slice(5))!;
      assert.ok(target, `${t.name}.${c.name} -> ${c.reference.table}`);
      assert.equal(c.type, target.columns.find((x) => x.primary_key)!.type, `${t.name}.${c.name}: FK type`);
      const self = target.name === t.name;
      assert.ok(self ? order.deferred_self_refs.some((d) => d.table === t.name && d.column === c.name) : seen.has(target.name),
        `${t.name}.${c.name}: FK target created earlier or deferred`);
    }
    for (const i of t.indexes) {
      assert.ok(!("method" in i), `${t.name}.${i.name}: legacy method`);
      assert.ok(i.type === "btree" || i.type === "gin");
      assert.ok(i.name.length <= MAX_INDEX_NAME, i.name);
      assert.ok(i.unique === undefined || i.unique === true, `${i.name}: unique only when true (platform echo)`);
    }
    seen.add(t.name);
  }
});

test("long index names match the names WP-INF-01 created on the platform", () => {
  const t = byName.get("discount_request_line")!;
  const full = "discount_request_line_discount_request_id_product_id_uq";
  assert.ok(t.indexes.some((i) => i.name === inf01ShortName(full) && i.unique), JSON.stringify(t.indexes));
});

test("validateShape rejects the legacy writer shape", () => {
  const legacy = {
    schema: "merc", name: "x", primary_key: ["id"],
    columns: [{ name: "id", type: "auto_uuid", required: true },
      { name: "a_id", type: "auto_uuid", required: true, references: { table: "a", column: "id" } }],
    indexes: [{ name: "x".repeat(60), columns: ["a_id"], method: "btree" }],
  } as unknown as ContractTable;
  const e = validateShape(legacy).join("\n");
  for (const s of ["unexpected key primary_key", "exactly one primary_key", "unexpected key references", "unexpected key method", "> 49"]) {
    assert.ok(e.includes(s), s);
  }
});

test("phase1 leaves out the deferred self-ref column and its index; others untouched", () => {
  const au = byName.get("app_user")!;
  const p = phase1(au, order.deferred_self_refs);
  assert.ok(!p.columns.some((c) => c.name === "manager_id"));
  assert.ok(!p.indexes.some((i) => i.columns.includes("manager_id")));
  assert.equal(p.columns.length, au.columns.length - 1);
  const acc = byName.get("account")!;
  assert.equal(phase1(acc, order.deferred_self_refs), acc, "no copy, no translation");
});

test("diff: platform echo (no on_delete for restrict, no unique:false) equals the contract", () => {
  const want = byName.get("discount_request")!;
  const existing = structuredClone(want);
  for (const c of existing.columns) if (c.reference?.on_delete === "restrict") delete c.reference.on_delete;
  existing.indexes.reverse();
  const d = diffTable(want, existing);
  assert.equal(needsUpdate(d), false);
  assert.deepEqual(d.drift, []);
});

test("diff: a new column is an update; type change is drift; extra platform columns are kept", () => {
  const want = byName.get("discount_request")!;
  const existing = structuredClone(want);
  existing.columns = existing.columns.filter((c) => c.name !== "buddy_conversation_id");
  existing.columns.push({ name: "legacy", type: "string", required: false });
  let d = diffTable(want, existing);
  assert.deepEqual(d.missingColumns, ["buddy_conversation_id"]);
  assert.deepEqual(d.drift, []);
  assert.ok(updateBody(want, existing).columns.some((c) => c.name === "legacy"));
  existing.columns[1].type = "number";
  d = diffTable(want, existing);
  assert.equal(d.drift.length, 1);
});

class FakePlatform implements Platform {
  writes: string[] = [];
  reads: string[] = [];
  tables: Map<string, PlatformTable>;
  constructor(tables: Map<string, PlatformTable>) { this.tables = tables; }
  async get(q: string) { this.reads.push(q); return structuredClone(this.tables.get(q) ?? null); }
  async create(t: PlatformTable) { this.writes.push(`create ${t.name}`); this.tables.set(`${t.schema}.${t.name}`, structuredClone(t)); }
  async update(q: string, body: { columns: PlatformTable["columns"]; indexes: PlatformTable["indexes"] }) {
    this.writes.push(`update ${q}`); const t = this.tables.get(q)!; t.columns = body.columns; t.indexes = body.indexes;
  }
}

function platformWithoutNewColumn() {
  const m = new Map<string, PlatformTable>();
  for (const t of tables) {
    const p = structuredClone(t);
    if (t.name === "discount_request") p.columns = p.columns.filter((c) => c.name !== "buddy_conversation_id");
    m.set(`merc.${t.name}`, p);
  }
  return m;
}

test("dry-run reads the platform, reports the diff and writes nothing", async () => {
  const fake = new FakePlatform(platformWithoutNewColumn());
  const log: string[] = [];
  const c = await applyAll(fake, tables, order.deferred_self_refs, true, (s) => log.push(s));
  assert.equal(fake.writes.length, 0);
  assert.ok(fake.reads.length >= tables.length);
  assert.deepEqual(c, { created: 0, updated: 1, unchanged: 63, drift: 0, failed: 0, deferredAdded: 0 });
  assert.ok(log.some((l) => l.startsWith("update   merc.discount_request: +cols[buddy_conversation_id]")));
});

test("apply adds only the new column; a re-run is a no-op", async () => {
  const fake = new FakePlatform(platformWithoutNewColumn());
  const c1 = await applyAll(fake, tables, order.deferred_self_refs, false, () => {});
  assert.deepEqual(fake.writes, ["update merc.discount_request"]);
  assert.equal(c1.updated, 1);
  fake.writes = [];
  const c2 = await applyAll(fake, tables, order.deferred_self_refs, false, () => {});
  assert.deepEqual(fake.writes, []);
  assert.deepEqual(c2, { created: 0, updated: 0, unchanged: 64, drift: 0, failed: 0, deferredAdded: 0 });
});

test("clean workspace: creates all 64 in order, then adds the deferred self-ref", async () => {
  const fake = new FakePlatform(new Map());
  const c = await applyAll(fake, tables, order.deferred_self_refs, false, () => {});
  assert.equal(c.created, 64);
  assert.equal(c.deferredAdded, 1);
  assert.equal(c.failed + c.drift, 0);
  assert.deepEqual(fake.tables.get("merc.app_user")!.columns, byName.get("app_user")!.columns);
});

test("Wful removes its temp body file even when the call fails", async () => {
  const seen: string[] = [];
  class Probe extends Wful {
    override async exec(args: string[]) {
      const p = args[args.indexOf("--data-file") + 1];
      assert.ok(existsSync(p)); seen.push(p);
      if (args[1] === "update") throw new Error("boom");
      return "{}";
    }
  }
  const w = new Probe({ workspace: "w", profile: "p" });
  await w.create(byName.get("role")!);
  await assert.rejects(w.update("merc.role", {}), /boom/);
  assert.equal(seen.length, 2);
  for (const p of seen) assert.ok(!existsSync(p), p);
  assert.ok(!readdirSync(tmpdir()).some((f) => seen.some((p) => p.includes(f) && f.startsWith("merc-tables-"))));
});
