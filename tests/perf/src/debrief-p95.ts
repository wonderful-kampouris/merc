// REQ-NFR-001: "The debrief p95 MUST be under 20 s, and the result card is visible within 25 s of stopping the
// recording. Load test: 20 debriefs, p95 measured."
//
// Measures from REAL dev runs of the deployed fn:debrief-process, never from fakes:
//   - server: `processing_ms` written by debrief-process (per run, from the debrief eval reports and, with
//     --live, from merc.voice_log rows still on dev);
//   - wall:   client-observed round trip of the same call (eval reports), the upper bound for "result card visible".
// It does NOT trigger debriefs itself: on dev a debrief creates voice_log/visit rows that the live meeting-loop
// crons act on (WhatsApp/call to the rep). New runs come from `evals/debrief/run.sh run-dev --repeat 2`.
//
//   node --experimental-strip-types tests/perf/src/debrief-p95.ts [--live] [--since 2026-11-15] [--out <dir>]
// Exit 0 = gate passes, 1 = p95 over budget, 2 = fewer than MIN_SAMPLES measured runs.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const REPORTS = join(ROOT, "evals/debrief/reports");
export const BUDGET_SERVER_MS = 20_000;
export const BUDGET_CARD_MS = 25_000;
export const MIN_SAMPLES = 20;
const W = ["--profile", "hackathon", "--workspace", "7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464"];

/** Nearest-rank percentile (same definition as the monitors and the eval scorer). */
export function percentile(values: number[], p: number): number | null {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

export interface Sample { source: string; id: string | null; server_ms: number | null; wall_ms: number | null; at: string }

/** Samples from debrief eval reports (`dev-*.json`), one per case run that reached the server. */
export function fromReports(dir: string, since?: string): Sample[] {
  if (!existsSync(dir)) return [];
  const out: Sample[] = [];
  for (const f of readdirSync(dir).filter((n) => /^dev-.*\.json$/.test(n)).sort()) {
    const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (since && String(r.at) < since) continue;
    for (const c of r.cases ?? []) {
      const server = typeof c.ms === "number" ? c.ms : null;
      const wall = typeof c.wall_ms === "number" ? c.wall_ms : null;
      if (server === null && wall === null) continue;
      if (c.status === undefined && server === null) continue; // errored before the function ran
      out.push({ source: `report:${f}`, id: c.voice_log_id ?? c.id ?? null, server_ms: server, wall_ms: wall, at: r.at });
    }
  }
  return out;
}

/** Read-only: processing_ms of voice_log rows on dev (no wall time there). */
export function fromDev(run: (args: string[]) => string = (a) => execFileSync("wful", [...W, ...a], { encoding: "utf8" })): Sample[] {
  const out: Sample[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = JSON.parse(run(["tables", "row-list", "merc.voice_log", "--limit", "200", "--page", String(page), "--json"]));
    const rows: any[] = Array.isArray(res.data) ? res.data : res.data?.rows ?? [];
    for (const e of rows) {
      const d = e.data ?? e;
      if (typeof d.processing_ms === "number") out.push({ source: "dev:merc.voice_log", id: d.id ?? e.id ?? null, server_ms: d.processing_ms, wall_ms: null, at: String(d.processed_at ?? e.created_at ?? "") });
    }
    if (!res.pagination?.has_next_page) break;
  }
  return out;
}

export interface Summary {
  samples: number; server: { n: number; p50: number | null; p95: number | null; max: number | null };
  wall: { n: number; p95: number | null }; budget_server_ms: number; budget_card_ms: number;
  pass: boolean; reason: string; sources: string[];
}

export function summarize(samples: Sample[]): Summary {
  // A voice_log already counted through a report must not be counted twice.
  const reported = new Set(samples.filter((s) => !s.source.startsWith("dev:") && s.id).map((s) => s.id));
  const uniq = samples.filter((s) => !(s.source.startsWith("dev:") && s.id && reported.has(s.id)));
  const server = uniq.map((s) => s.server_ms).filter((v): v is number => v !== null);
  const wall = uniq.map((s) => s.wall_ms).filter((v): v is number => v !== null);
  const p95 = percentile(server, 95), wp95 = percentile(wall, 95);
  let pass = true, reason = "ok";
  if (server.length < MIN_SAMPLES) { pass = false; reason = `only ${server.length} measured runs (< ${MIN_SAMPLES})`; }
  else if (p95! > BUDGET_SERVER_MS) { pass = false; reason = `server p95 ${p95} ms > ${BUDGET_SERVER_MS} ms`; }
  else if (wp95 !== null && wp95 > BUDGET_CARD_MS) { pass = false; reason = `wall p95 ${wp95} ms > ${BUDGET_CARD_MS} ms`; }
  return {
    samples: uniq.length,
    server: { n: server.length, p50: percentile(server, 50), p95, max: server.length ? Math.max(...server) : null },
    wall: { n: wall.length, p95: wp95 }, budget_server_ms: BUDGET_SERVER_MS, budget_card_ms: BUDGET_CARD_MS,
    pass, reason, sources: [...new Set(uniq.map((s) => s.source))],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const samples = [...fromReports(REPORTS, opt("since")), ...(argv.includes("--live") ? fromDev() : [])];
  const s = summarize(samples);
  const outDir = opt("out") ?? join(ROOT, "tests/perf/reports");
  mkdirSync(outDir, { recursive: true });
  const at = new Date().toISOString();
  const file = join(outDir, `debrief-p95-${at.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ at, ...s, samples_detail: samples }, null, 1) + "\n");
  console.log(JSON.stringify(s));
  console.log(`report: ${file}`);
  process.exit(s.pass ? 0 : s.server.n < MIN_SAMPLES ? 2 : 1);
}
