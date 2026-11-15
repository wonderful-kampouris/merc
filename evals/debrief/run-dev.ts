// Golden-set run on dev through the deployed fn:debrief-process (real model profile merc-extract, real tables).
//   evals/debrief/run.sh run-dev --rep <temp app_user id> [--only id,id] [--repeat N]
// The caller is the signed-in platform user, mapped to a TEMPORARY eval rep (see cleanup-dev.ts). Before the run
// the seeded rows the debriefs can touch are saved to reports/baseline-<rep>.json, so cleanup restores them exactly.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { factsFrom, inventedNumbers, runChecks, summarize, type Golden } from "./score";
import { arg, athensDate, callFn, getFn, rows } from "./dev";

const HERE = dirname(fileURLToPath(import.meta.url)).includes("/tmp") ? join(process.cwd(), "evals/debrief") : dirname(fileURLToPath(import.meta.url));
const g = JSON.parse(readFileSync(join(HERE, "golden.json"), "utf8")) as Golden;
const rep = arg("rep");
if (!rep) throw new Error("--rep <temp app_user id> is required (cleanup needs it)");
const only = arg("only")?.split(",") ?? null;
const repeat = Number(arg("repeat") ?? "1");
const reports = join(HERE, "reports");
mkdirSync(reports, { recursive: true });

// 1. baseline of seeded rows the debriefs may update (problem, deal, contact, visit of the golden accounts)
const accIds = new Set(Object.values(g.account_keys));
const basePath = join(reports, `baseline-${rep}.json`);
if (!existsSync(basePath)) {
  const base: Record<string, Array<Record<string, any>>> = {};
  for (const t of ["problem", "deal", "contact", "visit"]) base[t] = rows(t).filter((r) => accIds.has(r.account_id));
  writeFileSync(basePath, JSON.stringify(base, null, 1));
  console.log(`baseline saved: ${basePath}`);
}

const today = athensDate(Date.now());
const cases = g.cases.filter((c) => !only || only.includes(c.id));
const out: any[] = [];
for (let k = 0; k < repeat; k++) for (const c of cases) {
  const body = { utterance: c.utterance, account_id: c.account ? g.account_keys[c.account] : null, language: c.lang === "mixed" ? null : c.lang };
  const { ms, out: res } = callFn("debrief-process", body);
  if (res?.error) { console.log(`${c.id}: ERROR ${JSON.stringify(res.error).slice(0, 300)}`); out.push({ c, results: c.checks.map((check) => ({ check, pass: false, got: res.error })), invented: [], ms: null, wall_ms: ms, error: res.error }); continue; }
  const vlId = res.result?.voice_log_id ?? null;
  const actions = vlId ? rows("ai_action").filter((a) => a.voice_log_id === vlId) : [];
  const facts = factsFrom(res, actions as any, (iso) => athensDate(iso));
  const results = runChecks(c, facts, g, today);
  const invented = inventedNumbers(c.utterance, facts);
  let polled: unknown = null;
  if (vlId) { try { const p = getFn("debrief-result-get", { voice_log_id: vlId }); polled = p?.error ?? { same_lines: JSON.stringify(p.lines) === JSON.stringify(res.result.lines) }; } catch (e) { polled = String(e).slice(0, 200); } }
  const server = typeof res.result?.processing_ms === "number" ? res.result.processing_ms : null;
  console.log(`${c.id}: ${res.status} ${results.filter((r) => r.pass).length}/${results.length} invented=${invented.length} server=${server}ms wall=${ms}ms poll=${JSON.stringify(polled)}`);
  for (const r of results.filter((x) => !x.pass)) console.log(`   FAIL ${JSON.stringify(r.check)} got=${JSON.stringify(r.got)?.slice(0, 300)}`);
  out.push({ c, results, invented, ms: server, wall_ms: ms, voice_log_id: vlId, status: res.status, facts, missing: res.result?.missing_fields ?? [], summary: res.result?.spoken_summary ?? res.question, polled });
}
const s = summarize(out);
const wall = out.map((r) => r.wall_ms).sort((a, b) => a - b);
const report = { at: new Date().toISOString(), today, rep, summary: { ...s, wall_p95_ms: wall[Math.min(wall.length - 1, Math.ceil(0.95 * wall.length) - 1)] ?? null }, cases: out.map((r) => ({ id: r.c.id, lang: r.c.lang, status: r.status, passed: r.results.filter((x: any) => x.pass).length, total: r.results.length, failed: r.results.filter((x: any) => !x.pass), invented: r.invented, ms: r.ms, wall_ms: r.wall_ms, voice_log_id: r.voice_log_id, missing: r.missing, summary: r.summary, polled: r.polled })) };
const file = join(reports, `dev-${report.at.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.summary));
console.log(`report: ${file}`);
