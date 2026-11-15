// REQ-NFR-002: "Buddy first audio SHOULD come in under 1.5 s. Tool calls during a conversation SHOULD finish in
// under 3 s, except log-visit. Measured from the voice eval logs."
// Reads merc-buddy conversations on dev (read-only, `wful activities`), including eval/test traffic, and measures:
//   - tool latency: end_time - start_time of every tool transcription (platform-internal tools and log_visit excluded);
//   - first response: from the end of a customer turn to the start of the next agent turn (voice only = "first audio").
//   node --experimental-strip-types tests/perf/src/buddy-latency.ts [--days 7] [--limit 60]
// Exit 0 = both SHOULD budgets met (or no voice sample, reported), 1 = a budget is exceeded.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, percentile } from "./debrief-p95.ts";

export const TOOL_BUDGET_MS = 3_000;
export const FIRST_AUDIO_BUDGET_MS = 1_500;
export const EXCLUDED_TOOLS = new Set(["log_visit"]);
const W = ["--profile", "hackathon", "--workspace", "7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464"];

interface Tx { speaker: string; start_time?: number; end_time?: number; sequence?: number; tool_details?: { function_name?: string } }
export interface Activity { id: string; type: string; transcriptions?: Tx[] }

export function measure(acts: Activity[]) {
  const tools: Record<string, number[]> = {};
  const first: number[] = [];
  for (const a of acts) {
    const tx = [...(a.transcriptions ?? [])].sort((x, y) => (x.sequence ?? x.start_time ?? 0) - (y.sequence ?? y.start_time ?? 0));
    for (let i = 0; i < tx.length; i++) {
      const t = tx[i]!;
      const fn = t.tool_details?.function_name;
      if (fn && !fn.startsWith("__platform") && !EXCLUDED_TOOLS.has(fn) && typeof t.start_time === "number" && typeof t.end_time === "number" && t.end_time >= t.start_time) (tools[fn] ??= []).push(t.end_time - t.start_time);
      if (a.type === "voice" && t.speaker === "customer" && typeof t.end_time === "number") {
        const next = tx.slice(i + 1).find((n) => n.speaker === "agent" || n.speaker === "customer");
        if (next?.speaker === "agent" && typeof next.start_time === "number" && next.start_time >= t.end_time) first.push(next.start_time - t.end_time);
      }
    }
  }
  const all = Object.values(tools).flat();
  const perTool = Object.fromEntries(Object.entries(tools).map(([k, v]) => [k, { n: v.length, p95: percentile(v, 95) }]));
  const toolP95 = percentile(all, 95), firstP95 = percentile(first, 95);
  const over = Object.entries(perTool).filter(([, v]) => (v.p95 ?? 0) > TOOL_BUDGET_MS).map(([k]) => k);
  return {
    conversations: acts.length, tool_calls: all.length, tool_p95_ms: toolP95, per_tool: perTool, tools_over_budget: over,
    voice_turns: first.length, first_response_p95_ms: firstP95,
    pass: (toolP95 === null || toolP95 <= TOOL_BUDGET_MS) && (firstP95 === null || firstP95 <= FIRST_AUDIO_BUDGET_MS),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1]! : d; };
  const run = (a: string[]) => execFileSync("wful", [...W, ...a], { encoding: "utf8", maxBuffer: 64 << 20 });
  const agent = JSON.parse(run(["agents", "get", "merc-buddy", "--json"]));
  const agentId = agent.identity?.id ?? agent.id;
  const start = new Date(Date.now() - Number(opt("days", "7")) * 86_400_000).toISOString();
  const list = JSON.parse(run(["activities", "list", "--agent-id", agentId, "--include-test", "--start", start, "--limit", opt("limit", "60"), "--json"])) as Array<{ id: string }>;
  const acts = list.map((a) => JSON.parse(run(["activities", "get", a.id, "--json"])) as Activity);
  const m = measure(acts);
  const dir = join(ROOT, "tests/perf/reports");
  mkdirSync(dir, { recursive: true });
  const at = new Date().toISOString();
  const file = join(dir, `buddy-latency-${at.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ at, agent_id: agentId, since: start, ...m }, null, 1) + "\n");
  console.log(JSON.stringify(m));
  console.log(`report: ${file}`);
  process.exit(m.pass ? 0 : 1);
}
