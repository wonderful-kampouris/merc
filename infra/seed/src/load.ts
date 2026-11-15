// Seed loader (REQ-OPS-002): resolve tokens, load contracts/seed in _order.json order, optional reset.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Wful, type Row } from "./platform.ts";
import { chunks, loadSeed, plan } from "./seed.ts";
import { todayIn } from "./tokens.ts";

export interface Opts { workspace: string; profile: string; demoDay: string; reset: boolean; dryRun: boolean;
  wuidFile: string; contracts: string; out: string; schema: string }

function orgTz(contracts: string): string {
  const org = JSON.parse(readFileSync(resolve(contracts, "seed/organization.json"), "utf8")) as { timezone?: string }[];
  return org[0]?.timezone ?? "Europe/Athens";
}

function wuidMap(file: string, keys: string[], say: (s: string) => void): Record<string, string> {
  const m: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  for (const k of keys) if (!m[k] || m[k].startsWith("<")) {
    m[k] = `merc-demo-wuid-${k}`;
    say(`warn     @wuid:${k} has no id in ${file}; using placeholder ${m[k]}`);
  }
  return m;
}

export async function main(o: Opts): Promise<number> {
  const log: string[] = [];
  const say = (s: string) => { log.push(s); console.log(s); };
  const rawSeed = readFileSync(resolve(o.contracts, "seed/app_user.json"), "utf8");
  const keys = [...rawSeed.matchAll(/"@wuid:([^"]+)"/g)].map((m) => m[1]);
  const tz = orgTz(o.contracts);
  const ctx = { demoDay: o.demoDay, tz, wuid: wuidMap(o.wuidFile, keys, say) };
  const seed = loadSeed(o.contracts, ctx);
  say(`seed     demo day ${o.demoDay} (${tz}), ${seed.length} tables, ${seed.reduce((n, t) => n + t.rows.length, 0)} rows`);
  const w = new Wful(o.workspace, o.profile);
  const q = (t: string) => `${o.schema}.${t}`;
  const c = { inserted: 0, updated: 0, same: 0, deleted: 0, failed: 0 };

  if (o.reset) { // delete only rows whose key is in the seed, children first
    for (const t of [...seed].reverse()) {
      const ids = t.rows.map((r) => String(r[t.pk]));
      try {
        if (t.selfRefs.length && !o.dryRun) { // break self-references so the table empties in one pass
          const ex = await w.listAll(q(t.name));
          const keep = new Set(ids);
          for (const r of ex) if (keep.has(String(r.data[t.pk])) && t.selfRefs.some((k) => r.data[k] != null))
            await w.update(q(t.name), r.id, Object.fromEntries(t.selfRefs.map((k) => [k, null])));
        }
        let n = 0;
        for (const part of chunks(ids, 200)) n += o.dryRun ? 0 : Number((await w.deleteIn(q(t.name), t.pk, part)).data?.deleted ?? 0);
        c.deleted += n; say(`reset    ${q(t.name)}: -${n}`);
      } catch (e) { c.failed++; say(`FAIL     reset ${q(t.name)}: ${(e as Error).message}`); }
    }
  }

  for (const t of seed) {
    try {
      const existing = o.dryRun ? [] : await w.listAll(q(t.name));
      const p = plan(t, existing);
      // Self-referencing columns go in after every row of the table exists.
      const later: { key: string; data: Row }[] = [];
      const ins = p.insert.map((r) => {
        const set = Object.fromEntries(t.selfRefs.filter((k) => r[k] != null).map((k) => [k, r[k]]));
        if (!Object.keys(set).length) return r;
        later.push({ key: String(r[t.pk]), data: set });
        return { ...r, ...Object.fromEntries(Object.keys(set).map((k) => [k, null])) };
      });
      if (!o.dryRun) {
        for (const part of chunks(ins, 200)) await w.bulkInsert(q(t.name), part);
        for (const u of [...p.update, ...later.map((l) => ({ id: l.key, data: l.data }))]) await w.update(q(t.name), u.id, u.data);
      }
      c.inserted += p.insert.length; c.updated += p.update.length; c.same += p.same;
      say(`${p.insert.length || p.update.length ? "load    " : "ok      "} ${q(t.name)}: +${p.insert.length} ~${p.update.length} =${p.same}${o.dryRun ? " (dry-run)" : ""}`);
    } catch (e) { c.failed++; say(`FAIL     ${q(t.name)}: ${(e as Error).message}`); }
  }
  say(`summary: ${JSON.stringify(c)}`);
  mkdirSync(o.out, { recursive: true });
  writeFileSync(resolve(o.out, "last-run.log"), log.join("\n") + "\n");
  return c.failed ? 1 : 0;
}

function parseArgs(argv: string[]): Opts {
  const here = resolve(import.meta.dirname, "..");
  const contracts = resolve(here, "../../spec/contracts");
  const o: Opts = { workspace: "", profile: "hackathon", demoDay: "", reset: false, dryRun: false,
    wuidFile: resolve(here, "wuid.json"), contracts, out: resolve(here, "out"), schema: "merc" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => { const x = argv[++i]; if (!x) throw new Error(`${a} needs a value`); return x; };
    if (a === "--workspace") o.workspace = v();
    else if (a === "--profile") o.profile = v();
    else if (a === "--demo-day") o.demoDay = v();
    else if (a === "--reset") o.reset = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--wuid-file") o.wuidFile = resolve(v());
    else if (a === "--contracts") o.contracts = resolve(v());
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.workspace && !o.dryRun) throw new Error("--workspace <id> is required");
  if (!o.demoDay) o.demoDay = todayIn(orgTz(o.contracts));
  return o;
}

if (import.meta.filename === resolve(process.argv[1] ?? "")) {
  main(parseArgs(process.argv.slice(2))).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(2); });
}
