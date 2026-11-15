// reset-demo (WP-DEMO-01, REQ-OPS-002): put an environment back to the J5 starting point in under a minute.
//   1. delete the rows a J5 run created around Café Miltos (cleanupPlan; never a seed row, never another account),
//   2. converge the seed for the demo day (the infra/seed planner, run in parallel; Miltos seed rows reset in full),
//   3. optionally move the Miltos visit to start N minutes from now, so the previsit cron sends the brief live.
// Usage: see infra/demo/README.md. The workspace comes only from infra/deploy/environments.json (--env dev|demo).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyPhones } from "../../seed/src/load.ts";
import { Wful, type PRow } from "../../seed/src/platform.ts";
import { chunks, loadSeed, plan } from "../../seed/src/seed.ts";
import { todayIn } from "../../seed/src/tokens.ts";
import { DELETE_ORDER, MILTOS_VISIT, cleanupPlan, pool, promptNow, shiftVisit, withFullReset, type Snapshot } from "./demo-loop.ts";

export const ROOT = resolve(import.meta.dirname, "../../..");
const SCHEMA = "merc";

export interface Opts {
  env: "dev" | "demo"; demoDay: string; nextVisitIn: number | null; promptNow: boolean; liveOk: boolean; dryRun: boolean;
  cleanup: boolean; keepFeedback: boolean; concurrency: number; wuidFile: string; phonesFile: string; contracts: string;
}

export function parseArgs(argv: string[], now = Date.now()): Opts {
  const o: Opts = { env: "" as never, demoDay: "", nextVisitIn: null, promptNow: false, liveOk: false, dryRun: false, cleanup: true, keepFeedback: false, concurrency: 24,
    wuidFile: resolve(ROOT, "infra/seed/wuid.json"), phonesFile: resolve(ROOT, "infra/seed/phones.json"), contracts: resolve(ROOT, "spec/contracts") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => { const x = argv[++i]; if (x == null) throw new Error(`${a} needs a value`); return x; };
    if (a === "--env") o.env = v() as Opts["env"];
    else if (a === "--demo-day") o.demoDay = v();
    else if (a === "--next-visit-in") o.nextVisitIn = Number(v());
    else if (a === "--prompt-now") o.promptNow = true;
    else if (a === "--live-phone-ok") o.liveOk = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--no-cleanup") o.cleanup = false;
    else if (a === "--keep-feedback") o.keepFeedback = true;
    else if (a === "--concurrency") o.concurrency = Number(v());
    else if (a === "--wuid-file") o.wuidFile = resolve(v());
    else if (a === "--phones-file") o.phonesFile = resolve(v());
    else throw new Error(`unknown argument ${a}`);
  }
  if (o.env !== "dev" && o.env !== "demo") throw new Error("--env dev|demo is required; there is no default environment");
  if (o.demoDay && !/^\d{4}-\d{2}-\d{2}$/.test(o.demoDay)) throw new Error("--demo-day must be YYYY-MM-DD");
  if (!o.demoDay) o.demoDay = todayIn(orgTz(o.contracts), now);
  if (o.promptNow && o.nextVisitIn != null) throw new Error("--prompt-now and --next-visit-in are two different beats; pick one");
  if (o.promptNow && !o.liveOk && !o.dryRun) throw new Error("--prompt-now makes the live post-visit cron message the rep's real phone; add --live-phone-ok to confirm (or --dry-run)");
  if (o.nextVisitIn != null) {
    if (o.demoDay !== todayIn(orgTz(o.contracts), now)) throw new Error("--next-visit-in needs the demo day to be today (the cron only briefs today's visits)");
    // The deployed previsit cron WhatsApps (or calls, notify_channel=call) the rep's real phone once the visit is in the window.
    if (!o.liveOk && !o.dryRun) throw new Error("--next-visit-in makes the live previsit cron message the rep's real phone; add --live-phone-ok to confirm (or --dry-run)");
  }
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1 || o.concurrency > 64) throw new Error("--concurrency must be 1..64");
  return o;
}

export function envOf(name: string, file = resolve(ROOT, "infra/deploy/environments.json")): { profile: string; workspace: string } {
  const all = JSON.parse(readFileSync(file, "utf8"));
  const e = all[name];
  if (!e?.workspace || !e?.profile) throw new Error(`env ${name} has no profile/workspace in ${file}`);
  if (name === "demo" && e.workspace === all.dev?.workspace) throw new Error("demo workspace equals dev workspace; refusing");
  return { profile: e.profile, workspace: e.workspace };
}

function orgTz(contracts: string): string {
  const org = JSON.parse(readFileSync(resolve(contracts, "seed/organization.json"), "utf8")) as { timezone?: string }[];
  return org[0]?.timezone ?? "Europe/Athens";
}

function wuidMap(file: string, keys: string[]): Record<string, string> {
  const m: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  for (const k of keys) if (!m[k] || m[k].startsWith("<")) m[k] = `merc-demo-wuid-${k}`; // same placeholder as infra/seed
  return m;
}

export async function main(o: Opts, say: (s: string) => void = console.log): Promise<number> {
  const t0 = Date.now();
  const lap = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const { profile, workspace } = envOf(o.env);
  const w = new Wful(workspace, profile);
  const q = (t: string) => `${SCHEMA}.${t}`;
  const tz = orgTz(o.contracts);
  const keys = [...readFileSync(resolve(o.contracts, "seed/app_user.json"), "utf8").matchAll(/"@wuid:([^"]+)"/g)].map((m) => m[1]);
  const ctx = { demoDay: o.demoDay, tz, wuid: wuidMap(o.wuidFile, keys) };
  const seed = withFullReset(loadSeed(o.contracts, ctx));
  const phones = existsSync(o.phonesFile) ? JSON.parse(readFileSync(o.phonesFile, "utf8")) as Record<string, string> : null;
  const users = seed.find((t) => t.name === "app_user");
  const nPhones = users && phones ? applyPhones(users.rows, ctx.wuid, phones) : 0;
  say(`reset-demo env=${o.env} workspace=${workspace} demo-day=${o.demoDay} (${tz})${o.dryRun ? " DRY-RUN (no writes)" : ""}`);
  say(`seed     ${seed.length} tables, ${seed.reduce((n, t) => n + t.rows.length, 0)} rows; ${phones ? `${nPhones} real phone(s) from phones.json` : "no phones.json: every seed user keeps its seed phone"}`);
  let failed = 0;

  // --prompt-now is a mid-demo beat, not a reset: it only moves the visit, keeping the brief and the call rows.
  if (o.promptNow) {
    const v = (await w.listAll(q("visit"), [{ key: "id", operator: "eq", value: MILTOS_VISIT }]))[0];
    if (!v) { say(`FAIL     Café Miltos visit ${MILTOS_VISIT} not found; run a plain reset first`); return 1; }
    const p = promptNow(Date.now(), tz, Number(v.data.planned_duration_min ?? 30) || 30);
    if (!o.dryRun) await w.update(q("visit"), MILTOS_VISIT, { planned_date: p.planned_date, planned_start_at: p.planned_start_at, status: p.status });
    say(`visit    Café Miltos ended; starts ${p.planned_start_at}; "How did it go" by the cron tick at ${p.prompt_by}${o.dryRun ? " (dry-run)" : ""}`);
    say(`summary  ok in ${lap()}`);
    return 0;
  }

  // 1. J5 artefacts around Café Miltos.
  if (o.cleanup) {
    const seedIds = Object.fromEntries(seed.map((t) => [t.name, new Set(t.rows.map((r) => String(r[t.pk])))]));
    const lists = await pool([...DELETE_ORDER], 8, (t) => w.listAll(q(t)).then((rs) => [t, rs.map((r) => ({ ...r.data, id: r.data.id ?? r.id }))] as const));
    const del = cleanupPlan(Object.fromEntries(lists) as Snapshot, seedIds);
    // --keep-feedback: the "next week" brief of the fallback video; rep_feedback (by account) survives the reset.
    if (o.keepFeedback) { if (del.rep_feedback.length) say(`keep     ${q("rep_feedback")}: ${del.rep_feedback.length} J5 row(s) kept (--keep-feedback)`); del.rep_feedback = []; }
    for (const t of DELETE_ORDER) {
      const ids = del[t];
      if (!ids.length) continue;
      try {
        let n = 0;
        for (const part of chunks(ids, 200)) n += o.dryRun ? part.length : Number((await w.deleteIn(q(t), "id", part)).data?.deleted ?? part.length);
        say(`clean    ${q(t)}: -${n}${o.dryRun ? " (dry-run)" : ""}`);
      } catch (e) { failed++; say(`FAIL     clean ${q(t)}: ${(e as Error).message}`); }
    }
    say(`clean    done at ${lap()} (${DELETE_ORDER.reduce((n, t) => n + del[t].length, 0)} J5 rows)`);
  }

  // 2. Converge: list every seed table in parallel, insert in seed order (parents first), then all PUTs in parallel.
  const existing = await pool(seed, 8, (t) => w.listAll(q(t.name)).catch((e) => { failed++; say(`FAIL     list ${q(t.name)}: ${(e as Error).message}`); return null as PRow[] | null; }));
  const puts: { table: string; id: string; data: Record<string, unknown> }[] = [];
  const totals = { inserted: 0, updated: 0, same: 0 };
  for (const [i, t] of seed.entries()) {
    const have = existing[i];
    if (!have) continue;
    const p = plan(t, have);
    const later: typeof puts = [];
    const ins = p.insert.map((r) => {
      const set = Object.fromEntries(t.selfRefs.filter((k) => r[k] != null).map((k) => [k, r[k]]));
      if (!Object.keys(set).length) return r;
      later.push({ table: t.name, id: String(r[t.pk]), data: set });
      return { ...r, ...Object.fromEntries(Object.keys(set).map((k) => [k, null])) };
    });
    try { if (!o.dryRun) for (const part of chunks(ins, 200)) await w.bulkInsert(q(t.name), part); }
    catch (e) { failed++; say(`FAIL     insert ${q(t.name)}: ${(e as Error).message}`); continue; }
    puts.push(...p.update.map((u) => ({ table: t.name, id: u.id, data: u.data })), ...later);
    totals.inserted += p.insert.length; totals.updated += p.update.length; totals.same += p.same;
    if (p.insert.length || p.update.length) say(`seed     ${q(t.name)}: +${p.insert.length} ~${p.update.length} =${p.same}`);
  }
  if (!o.dryRun) await pool(puts, o.concurrency, async (u) => {
    try { await w.update(q(u.table), u.id, u.data); } catch (e) { failed++; say(`FAIL     put ${q(u.table)}/${u.id}: ${(e as Error).message.slice(0, 200)}`); }
  });
  say(`seed     done at ${lap()}: ${JSON.stringify(totals)}`);

  // 3. Live brief: move the Miltos visit into the previsit window.
  if (o.nextVisitIn != null) {
    const s = shiftVisit(Date.now(), o.nextVisitIn, tz);
    const data = { planned_date: s.planned_date, planned_start_at: s.planned_start_at, status: s.status, started_at: null, completed_at: null, outcome: null };
    if (!o.dryRun) {
      try { await w.update(q("visit"), MILTOS_VISIT, data); } catch (e) { failed++; say(`FAIL     shift visit: ${(e as Error).message}`); }
    }
    say(`visit    Café Miltos ${MILTOS_VISIT} starts ${s.planned_start_at}; brief due from ${s.brief_due_at}, sent by the cron tick at ${s.brief_by}${o.dryRun ? " (dry-run)" : ""}`);
  }
  const secs = (Date.now() - t0) / 1000;
  say(`summary  ${failed ? `FAILED (${failed})` : "ok"} in ${secs.toFixed(1)}s${secs >= 60 ? " (over the 1 min budget)" : ""}`);
  return failed ? 1 : 0;
}

if (import.meta.filename === resolve(process.argv[1] ?? "")) {
  let o: Opts;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`reset-demo: ${(e as Error).message}`); process.exit(2); }
  main(o).then((c) => process.exit(c), (e) => { console.error(`reset-demo: ${(e as Error).message}`); process.exit(2); });
}
