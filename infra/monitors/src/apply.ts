// Creates or updates the Merc monitors (contracts/platform/platform.json#monitors, REQ-OPS-003) in one environment.
//   node --experimental-strip-types infra/monitors/src/apply.ts --env dev            # plan: print bodies, change nothing
//   node --experimental-strip-types infra/monitors/src/apply.ts --env dev --push     # deploy the watch crons, upsert monitors
//   ... --recipient someone@example.com     # notification recipient (default: the signed-in wful user's email; kind user_email returned HTTP 500 on 2026-11-15)
// Idempotent: a monitor is matched by name (merc-<key>) and updated, never duplicated. Never deletes anything.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, allBodies, watchSlug, type MonitorBody, type Recipient } from "./monitors.ts";
import { WATCH_KEYS } from "./watches.ts";

export interface Env { profile: string; workspace: string }
export function envOf(name: string): Env {
  if (name !== "dev" && name !== "demo") throw new Error(`--env must be dev or demo (got ${JSON.stringify(name)}); there is no default`);
  const e = JSON.parse(readFileSync(join(ROOT, "infra/deploy/environments.json"), "utf8"))[name];
  if (!e?.workspace || !e?.profile) throw new Error(`env ${name} has no workspace/profile in infra/deploy/environments.json`);
  return { profile: e.profile, workspace: e.workspace };
}

export type Run = (args: string[]) => string;
export const wfulRunner = (env: Env): Run => (args) => execFileSync("wful", ["--profile", env.profile, "--workspace", env.workspace, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const list = (out: string): any[] => { const d = JSON.parse(out); return Array.isArray(d) ? d : d.items ?? d.data ?? []; };

/** slug -> function id for the merc-watch-* crons. */
export function cronIds(run: Run): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const f of list(run(["functions", "cron", "list", "--json"]))) {
    const slug = f.slug ?? f.path_slug ?? f.name;
    if (typeof slug === "string" && slug.startsWith("merc-watch-")) ids[slug] = String(f.id);
  }
  return ids;
}

export interface Planned { name: string; action: "create" | "update"; id: string | null; body: MonitorBody }
export function plan(bodies: MonitorBody[], existing: any[]): Planned[] {
  return bodies.map((body) => {
    const hit = existing.filter((m) => m.name === body.name);
    if (hit.length > 1) throw new Error(`more than one monitor named ${body.name}; fix by hand before applying`);
    return { name: body.name, action: hit.length ? "update" : "create", id: hit[0]?.id ?? null, body };
  });
}

/** Fields that must read back exactly as sent (REQ-OPS-003 verification). */
export function verify(sent: MonitorBody, got: any): string[] {
  const bad: string[] = [];
  for (const k of ["name", "metric", "estimator", "window_value", "time_unit", "interval", "severity", "active", "resource_type", "resource_id"] as const) {
    const g = got?.[k] ?? null, s = (sent as any)[k] ?? null;
    if (g !== s) bad.push(`${k}: sent ${JSON.stringify(s)} got ${JSON.stringify(g)}`);
  }
  const leaf = (t: any) => (t?.children?.length ? t.children[0] : t);
  if (leaf(got?.trigger_conditions)?.value !== sent.trigger_conditions.children[0]!.value) bad.push("trigger value");
  if (!Array.isArray(got?.recipients) || got.recipients.length < 1) bad.push("recipients");
  return bad;
}

/**
 * Deploy one merc-watch cron to its OWN repo (wful functions cron create --dedicated-repo).
 * Why not infra/deploy/deploy.sh: pushes to the shared workspace functions.git timed out (HTTP 524) on
 * 2026-11-15, while dedicated per-function repos push in seconds (the demo workspace uses them too). The watches are
 * WP-QA-02's own functions, so they never share a folder with another builder. Same safety as deploy.sh: provision
 * if missing, replace only functions/<slug>/, secret-scan before commit, never force-push, never delete.
 */
export function deployWatch(slug: string, run: Run, git: (args: string[], cwd: string) => string = (a, cwd) => execFileSync("git", a, { cwd, encoding: "utf8" })) {
  const src = join(ROOT, "infra/monitors/out/functions", slug);
  const cfg = JSON.parse(readFileSync(join(src, "config.json"), "utf8"));
  const dir = join(mkdtempSync(join(tmpdir(), "merc-watch-")), slug);
  const exists = cronIds(run)[slug];
  const timeout = (e: unknown) => /deadline exceeded|Timeout|524/.test(String((e as Error).message ?? e));
  if (!exists) {
    const data = JSON.stringify({ cron_schedules: cfg.cron_schedules, timeout_ms: cfg.timeout_ms });
    try { run(["--no-interactive", "functions", "cron", "create", "--slug", slug, "--name", slug, "--description", cfg.description, "--data", data, "--dedicated-repo", "--dir", dir, "--skip-install"]); }
    catch (e) { if (!timeout(e) || !cronIds(run)[slug]) throw e; } // the API can time out after creating it
    console.log(`provisioned cron function ${slug} (dedicated repo)`);
  }
  if (!existsSync(join(dir, ".git"))) run(["functions", "cron", "clone", slug, "--dir", dir, "--skip-install"]);
  const dest = join(dir, "functions", slug);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  execFileSync("python3", ["-I", join(ROOT, "scripts/secret-scan.py"), "--root", dest], { stdio: "inherit" });
  git(["add", "-A"], dir);
  if (!git(["status", "--porcelain"], dir).trim()) { console.log(`no changes: ${slug} already deployed`); return; }
  git(["commit", "-q", "-m", `deploy ${slug} from merc monorepo infra/monitors (WP-QA-02)`], dir);
  for (let attempt = 1; ; attempt++) {
    try { git(["push", "-q", "origin", "HEAD:main"], dir); break; }
    catch (e) { if (attempt >= 3) throw e; git(["pull", "-q", "--rebase", "origin", "main"], dir); }
  }
  console.log(`pushed ${slug}`);
}

function main(argv: string[]) {
  const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const envName = opt("env") ?? "";
  const env = envOf(envName);
  const run = wfulRunner(env);
  const push = argv.includes("--push");

  if (push) for (const key of WATCH_KEYS) deployWatch(watchSlug(key), run);
  const ids = cronIds(run);
  const email = opt("recipient");
  const whoami = email ? null : (/Email:\s*(\S+)/.exec(run(["whoami"]))?.[1] ?? null);
  const recipients: Recipient[] = email ? [{ kind: "email", value: email }] : whoami ? [{ kind: "email", value: whoami }] : [];
  if (!recipients.length) throw new Error("no recipient: pass --recipient <email> (the platform refuses monitors without one)");

  const missing = WATCH_KEYS.map(watchSlug).filter((s) => !ids[s]);
  if (missing.length && !push) { console.log(`plan: crons not deployed yet: ${missing.join(", ")} (run with --push)`); return; }
  const planned = plan(allBodies(ids, recipients), list(run(["alerts", "monitor-list", "--json"])));
  for (const p of planned) console.log(`${push ? "" : "plan: "}${p.action} ${p.name} ${p.body.metric} ${p.body.resource_type}:${p.body.resource_id ?? "*"} > ${p.body.trigger_conditions.children[0]!.value} / ${p.body.window_value} ${p.body.time_unit}`);
  if (!push) return;

  const dir = mkdtempSync(join(tmpdir(), "merc-monitors-"));
  const failures: string[] = [];
  for (const p of planned) {
    const file = join(dir, `${p.name}.json`);
    writeFileSync(file, JSON.stringify(p.body, null, 1));
    const out = p.action === "create" ? run(["alerts", "monitor-create", "--value-file", file, "--json"]) : run(["alerts", "monitor-update", p.id!, "--value-file", file, "--json"]);
    const id = p.id ?? JSON.parse(out).id;
    const got = JSON.parse(run(["alerts", "monitor-get", id, "--json"]));
    const bad = verify(p.body, got);
    console.log(`${p.action}d ${p.name} id=${id} ${bad.length ? `MISMATCH ${bad.join("; ")}` : "verified"}`);
    if (bad.length) failures.push(p.name);
  }
  if (failures.length) { console.error(`monitors not verified: ${failures.join(", ")}`); process.exit(1); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
