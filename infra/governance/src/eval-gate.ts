// CI eval gate (REQ-OPS-004): "Eval suites (buddy, approver, debrief, research, and the other LLM schemas) MUST
// run in CI and gate demo promotion. A failing eval blocks promotion."
//
//   node --experimental-strip-types infra/governance/src/eval-gate.ts                 # report gate from files on disk
//   node --experimental-strip-types infra/governance/src/eval-gate.ts --run --env dev # also run the agent eval batches now
//   ... --only merc-buddy,debrief_extraction   # restrict (a restricted gate never passes a promotion, see promote-demo.sh)
// Exit 0 = every required suite passed; 1 = at least one failed or is missing. Writes infra/governance/reports/.
//
// Suites come from the contracts, so a new agent or LLM schema is gated without editing this file:
//   - every agent in spec/contracts/agents/ -> agents/<slug>/evals/batches/*.json, run with `wful eval run --batch`
//     against a snapshot of the deployed clone (infra/deploy/.cache/<env>/agent-<slug>); pass >= 90% of scenarios.
//   - every LLM schema in spec/contracts/llm/ -> its `eval_set` folder; the newest reports/*.json must exist, be
//     fresher than MAX_AGE_H and meet the schema's bar (debrief: field-level >= 90% and no invented numbers, REQ-NFR-004).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const PASS_PCT = 90;
export const MAX_AGE_H = 24;
/**
 * Suites whose feature is cut from the demo freeze (discounts/approver, prospecting, AI import, management screens):
 * still evaluated and reported, but a failure is a warning, not a block. Remove a name here to make it blocking.
 */
export const FREEZE_CUT = new Set(["merc-approver", "merc-insights", "merc-research", "research_dossier", "candidate_score", "import_mapping", "campaign_from_text"]);

export type Status = "pass" | "fail" | "missing";
export interface SuiteResult { suite: string; kind: "agent" | "llm"; status: Status; detail: string; required: boolean; pct?: number | null }

// ------------------------------------------------------------------------------------------- discovery
export interface Suite { suite: string; kind: "agent" | "llm"; dir: string; required: boolean }
export function discover(root = ROOT): Suite[] {
  const out: Suite[] = [];
  for (const f of readdirSync(join(root, "spec/contracts/agents")).filter((n) => n.endsWith(".json")).sort()) {
    const slug = f.slice(0, -5);
    out.push({ suite: slug, kind: "agent", dir: join(root, "agents", slug, "evals"), required: !FREEZE_CUT.has(slug) });
  }
  for (const f of readdirSync(join(root, "spec/contracts/llm")).filter((n) => n.endsWith(".json")).sort()) {
    const c = JSON.parse(readFileSync(join(root, "spec/contracts/llm", f), "utf8"));
    if (!c.eval_set) continue;
    const name = c.name ?? f.slice(0, -5);
    out.push({ suite: name, kind: "llm", dir: join(root, c.eval_set), required: !FREEZE_CUT.has(name) });
  }
  return out;
}

// ------------------------------------------------------------------------------------------- scoring
/** Count passed/total scenario outcomes in a `wful eval run --batch --json` result, whatever its exact nesting. */
export function batchOutcomes(result: unknown): { passed: number; total: number } {
  let passed = 0, total = 0;
  const visit = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const verdict = typeof o.verdict === "string" ? o.verdict.toLowerCase() : typeof o.status === "string" && ("scenario_slug" in o || "scenario" in o) ? o.status.toLowerCase() : null;
    const bool = typeof o.passed === "boolean" ? o.passed : typeof o.success === "boolean" ? o.success : null;
    if (("scenario_slug" in o || "scenario" in o || "scenario_id" in o) && (verdict !== null || bool !== null)) {
      total++;
      if (bool === true || (verdict !== null && /^(pass|passed|success|succeeded)$/.test(verdict))) passed++;
      return;
    }
    Object.values(o).forEach(visit);
  };
  visit(result);
  return { passed, total };
}

/** The newest eval report of an LLM suite, judged against its bar. */
export function judgeLlm(s: Suite, now = Date.now()): SuiteResult {
  const base = { suite: s.suite, kind: "llm" as const, required: s.required };
  const rep = join(s.dir, "reports");
  if (!existsSync(s.dir)) return { ...base, status: "missing", detail: `no eval set at ${rel(s.dir)}` };
  const files = existsSync(rep) ? readdirSync(rep).filter((n) => n.endsWith(".json") && !n.startsWith("baseline")).sort() : [];
  if (!files.length) return { ...base, status: "missing", detail: `eval set exists but has no reports/ (never run)` };
  const newest = files[files.length - 1]!;
  const ageH = (now - statSync(join(rep, newest)).mtimeMs) / 3_600_000;
  const r = JSON.parse(readFileSync(join(rep, newest), "utf8"));
  const sm = r.summary ?? r;
  const pct: number | null = typeof sm.field_level_pct === "number" ? sm.field_level_pct : typeof sm.pass_pct === "number" ? sm.pass_pct
    : typeof sm.passed === "number" && typeof sm.checks === "number" && sm.checks > 0 ? (100 * sm.passed) / sm.checks : null;
  if (pct === null) return { ...base, status: "fail", detail: `${newest}: no pass rate in summary`, pct };
  const invented = typeof sm.invented_numbers === "number" ? sm.invented_numbers : 0;
  const ok = pct >= PASS_PCT && invented === 0 && ageH <= MAX_AGE_H;
  const why = [`${pct.toFixed(1)}% (bar ${PASS_PCT}%)`, invented ? `${invented} invented numbers` : "", ageH > MAX_AGE_H ? `report ${ageH.toFixed(0)} h old (> ${MAX_AGE_H} h)` : ""].filter(Boolean).join(", ");
  return { ...base, status: ok ? "pass" : "fail", detail: `${newest}: ${why}`, pct };
}

export function judgeAgentFiles(s: Suite): { batches: string[]; result: SuiteResult | null } {
  const base = { suite: s.suite, kind: "agent" as const, required: s.required };
  const bdir = join(s.dir, "batches");
  const batches = existsSync(bdir) ? readdirSync(bdir).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)).sort() : [];
  if (!batches.length) return { batches, result: { ...base, status: "missing", detail: `no eval batches at ${rel(bdir)}` } };
  return { batches, result: null };
}

export function gate(results: SuiteResult[]): { pass: boolean; blocking: SuiteResult[]; warnings: SuiteResult[] } {
  const bad = results.filter((r) => r.status !== "pass");
  return { pass: bad.every((r) => !r.required), blocking: bad.filter((r) => r.required), warnings: bad.filter((r) => !r.required) };
}

const rel = (p: string) => p.replace(`${ROOT}/`, "");

// ------------------------------------------------------------------------------------------- run
export type Runner = (args: string[], cwd?: string) => string;

export function runAgent(s: Suite, batches: string[], env: { profile: string; workspace: string; name: string }, run: Runner): SuiteResult {
  const base = { suite: s.suite, kind: "agent" as const, required: s.required };
  const clone = join(ROOT, "infra/deploy/.cache", env.name, `agent-${s.suite}`);
  if (!existsSync(clone)) return { ...base, status: "fail", detail: `no deployed clone at ${rel(clone)} (run infra/deploy/deploy.sh agent:${s.suite} --env ${env.name} first)` };
  let passed = 0, total = 0;
  const snap = run(["agents", "snapshot"], clone).trim().split(/\s+/).pop()!;
  for (const b of batches) {
    try {
      const out = run(["eval", "run", b, "--batch", "--snapshot-id", snap, "--json", "--poll-timeout", "20m"], clone);
      const o = batchOutcomes(JSON.parse(out));
      passed += o.passed; total += o.total;
    } catch (e) {
      return { ...base, status: "fail", detail: `batch ${b} did not finish: ${String((e as Error).message).slice(0, 200)}` };
    }
  }
  const pct = total ? (100 * passed) / total : null;
  return { ...base, status: pct !== null && pct >= PASS_PCT ? "pass" : "fail", detail: `${passed}/${total} scenarios over ${batches.length} batches (snapshot ${snap})`, pct };
}

function main(argv: string[]) {
  const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const only = opt("only")?.split(",");
  const doRun = argv.includes("--run");
  let env: { profile: string; workspace: string; name: string } | null = null;
  if (doRun) {
    const name = opt("env");
    if (name !== "dev" && name !== "demo") throw new Error("--run needs --env dev|demo (no default)");
    env = { ...JSON.parse(readFileSync(join(ROOT, "infra/deploy/environments.json"), "utf8"))[name], name };
  }
  const run: Runner = (a, cwd) => execFileSync("wful", ["--profile", env!.profile, "--workspace", env!.workspace, ...a], { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });

  const results: SuiteResult[] = [];
  for (const s of discover().filter((x) => !only || only.includes(x.suite))) {
    if (s.kind === "llm") { results.push(judgeLlm(s)); continue; }
    const { batches, result } = judgeAgentFiles(s);
    if (result) { results.push(result); continue; }
    results.push(doRun ? runAgent(s, batches, env!, run) : { suite: s.suite, kind: "agent", required: s.required, status: "fail", detail: `${batches.length} batches present; not run (pass --run --env dev)` });
  }
  const g = gate(results);
  for (const r of results) console.log(`${r.status.toUpperCase().padEnd(7)} ${r.required ? "required" : "warn    "} ${r.kind.padEnd(5)} ${r.suite.padEnd(22)} ${r.detail}`);
  console.log(g.pass ? `EVAL GATE: PASS${only ? " (restricted: --only)" : ""}` : `EVAL GATE: FAIL, ${g.blocking.length} required suite(s) not passing: ${g.blocking.map((r) => r.suite).join(", ")}`);
  const dir = join(ROOT, "infra/governance/reports");
  mkdirSync(dir, { recursive: true });
  const at = new Date().toISOString();
  writeFileSync(join(dir, `eval-gate-${at.replace(/[:.]/g, "-")}.json`), JSON.stringify({ at, only: only ?? null, ran: doRun, pass: g.pass, results }, null, 1) + "\n");
  process.exit(g.pass ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
