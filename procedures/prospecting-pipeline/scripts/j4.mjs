// J4 on dev (REQ-PRS-001): start the published merc-prospecting-pipeline for a fresh Chalandri bakery search
// (CSV source) and check 18 found, 5 duplicates, 13 scored in under 5 minutes.
//   node procedures/prospecting-pipeline/scripts/j4.mjs --env dev                # run, report, then clean up its rows
//   node procedures/prospecting-pipeline/scripts/j4.mjs --env dev --keep         # keep the rows (demo data)
//   node procedures/prospecting-pipeline/scripts/j4.mjs --env dev --cleanup <search_id>
// Only rows this script created (the search and everything hanging off it) are deleted. Dedupe looks at every live
// candidate of the org, so a kept J4 search makes the next run see its shops as duplicates: clean up before re-running.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "../../..");
const args = process.argv.slice(2);
const envName = args[args.indexOf("--env") + 1];
const env = JSON.parse(readFileSync(join(ROOT, "infra/deploy/environments.json"), "utf8"))[envName];
if (envName !== "dev" || !env?.workspace) { console.error("usage: j4.mjs --env dev [--keep | --cleanup <search_id>]"); process.exit(2); }
const deployed = JSON.parse(readFileSync(join(here, `../deployed.${envName}.json`), "utf8"));
const wful = (...a) => execFileSync("wful", ["--profile", env.profile, "--workspace", env.workspace, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const J = (s) => JSON.parse(s);
const rows = (table) => { const r = J(wful("tables", "row-list", table, "--limit", "500", "--json")); return (r.data ?? r).map((x) => ({ id: x.id, ...x.data })); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const EXPECTED = { found: 18, duplicates: 5, scored: 13, max_ms: 5 * 60 * 1000 };
const REQUESTER_NAME = "Nikos Alexiou";

function cleanup(searchId) {
  const cands = rows("merc.candidate").filter((c) => c.search_id === searchId).map((c) => c.id);
  const scores = rows("merc.candidate_score").filter((s) => cands.includes(s.candidate_id)).map((s) => s.id);
  const reasons = rows("merc.candidate_score_reason").filter((r) => scores.includes(r.score_id)).map((r) => r.id);
  const dossiers = rows("merc.dossier").filter((d) => cands.includes(d.candidate_id) && !d.account_id).map((d) => d.id);
  const facts = rows("merc.dossier_fact").filter((f) => dossiers.includes(f.dossier_id)).map((f) => f.id);
  for (const [t, ids] of [["merc.candidate_score_reason", reasons], ["merc.candidate_score", scores], ["merc.dossier_fact", facts], ["merc.dossier", dossiers], ["merc.candidate", cands], ["merc.prospect_search", [searchId]]])
    for (const id of ids) wful("tables", "row-delete", t, id, "--force");
  console.log(`cleanup ${searchId}: ${cands.length} candidates, ${scores.length} scores, ${reasons.length} reasons, ${dossiers.length} dossiers, ${facts.length} facts`);
}

if (args.includes("--cleanup")) { cleanup(args[args.indexOf("--cleanup") + 1]); process.exit(0); }

const nikos = rows("merc.app_user").find((u) => u.full_name === REQUESTER_NAME);
const cat = rows("merc.account_category").find((c) => /baker/i.test(c.name));
const search = J(wful("tables", "row-insert", "merc.prospect_search", "--json", "--data", JSON.stringify({ org_id: nikos.org_id, requested_by: nikos.id, category_id: cat?.id ?? null, area_text: "Chalandri", origin: "manual", status: "running" })));
console.log(`search ${search.id} (requested_by ${REQUESTER_NAME})`);
const t0 = Date.now();
const run = J(wful("automations", "run", deployed.procedures["merc-prospecting-pipeline"], "--trigger", JSON.stringify({ search_id: search.id }), "--json"));
wful("tables", "row-update", "merc.prospect_search", search.id, "--data", JSON.stringify({ procedure_run_id: run.run_id }));
console.log(`run ${run.run_id}`);
let r;
for (;;) {
  r = J(wful("automations", "run-get", run.run_id, "--json"));
  if (["succeeded", "failed", "cancelled", "interrupted"].includes(r.status)) break;
  if (Date.now() - t0 > EXPECTED.max_ms + 120_000) break;
  await sleep(5000);
}
const ms = Date.now() - t0;
for (const s of r.steps ?? []) console.log(`  ${s.node_id} ${s.status} ${JSON.stringify(s.output ?? s.error ?? null).slice(0, 220)}`);
const cands = rows("merc.candidate").filter((c) => c.search_id === search.id);
const byStatus = cands.reduce((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {});
const fin = (r.steps ?? []).find((s) => s.node_id === "function-7")?.output ?? {};
const got = { found: cands.length, duplicates: byStatus.duplicate ?? 0, scored: byStatus.scored ?? 0, ms };
console.log(`run ${r.status} in ${(ms / 1000).toFixed(0)} s; candidates by status ${JSON.stringify(byStatus)}; finalize ${JSON.stringify(fin)}`);
const pass = got.found === EXPECTED.found && got.duplicates === EXPECTED.duplicates && got.scored === EXPECTED.scored && ms < EXPECTED.max_ms && r.status === "succeeded";
console.log(`J4 ${pass ? "PASS" : "FAIL"}: found ${got.found}/18, duplicates ${got.duplicates}/5, scored ${got.scored}/13, ${(ms / 1000).toFixed(0)} s < 300 s`);
if (!args.includes("--keep")) cleanup(search.id);
process.exit(pass ? 0 : 1);
