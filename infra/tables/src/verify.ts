// Read-only check: schema merc on the platform holds every contract table with its FKs and indexes.
import { resolve } from "node:path";
import { Wful, loadContracts } from "./apply.ts";
import { diffTable } from "./diff.ts";
import { validateShape } from "./payload.ts";

const args = process.argv.slice(2);
const flag = (n: string, d = "") => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const workspace = flag("--workspace");
if (!workspace) { console.error("--workspace <id> is required"); process.exit(2); }
const w = new Wful({ workspace, profile: flag("--profile", "hackathon") });
const { tables } = loadContracts(resolve(import.meta.dirname, "../../../spec/contracts/tables"));

const listed = JSON.parse(await w.exec(["tables", "list", "--search", "", "--limit", "200", "--json"])) as { schema?: string; name: string }[];
const inMerc = listed.filter((t) => t.schema === "merc");
let fks = 0, idx = 0, bad = 0;
for (const t of tables) {
  const shape = validateShape(t);
  if (shape.length) { bad++; console.log(`BAD shape ${shape.join("; ")}`); continue; }
  const want = t;
  const ex = await w.get(`merc.${t.name}`);
  if (!ex) { bad++; console.log(`MISSING merc.${t.name}`); continue; }
  const d = diffTable(want, ex);
  const issues = [...d.drift, ...d.missingColumns.map((c) => `missing col ${c}`), ...d.missingRefs.map((c) => `missing fk ${c}`), ...d.missingIndexes.map((i) => `missing idx ${i}`)];
  fks += ex.columns.filter((c) => c.reference).length;
  idx += (ex.indexes ?? []).length;
  if (issues.length) { bad++; console.log(`BAD merc.${t.name}: ${issues.join("; ")}`); }
}
const wantFks = tables.reduce((n, t) => n + t.columns.filter((c) => c.reference).length, 0);
const wantIdx = tables.reduce((n, t) => n + (t.indexes ?? []).length, 0);
console.log(`listed in schema merc: ${inMerc.length}; contract tables: ${tables.length}`);
console.log(`fks on platform: ${fks}/${wantFks}; indexes on platform: ${idx}/${wantIdx}; tables with issues: ${bad}`);
process.exit(bad || inMerc.length !== tables.length || fks !== wantFks || idx !== wantIdx ? 1 : 0);
