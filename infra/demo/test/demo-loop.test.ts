import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { loadSeed } from "../../seed/src/seed.ts";
import { DELETE_ORDER, MILTOS_ACCOUNT, MILTOS_VISIT, cleanupPlan, pool, promptNow, shiftVisit, withFullReset, type Snapshot } from "../src/demo-loop.ts";
import { parseArgs } from "../src/reset.ts";

const contracts = resolve(import.meta.dirname, "../../../spec/contracts");
const OTHER = "00000000-0000-5000-8000-000000000001";
const seedIds = { visit: new Set([MILTOS_VISIT]), problem: new Set(["seed-problem"]), sales_order: new Set(["seed-order"]) };

function j5Snapshot(): Snapshot {
  return {
    voice_log: [{ id: "vl1", account_id: MILTOS_ACCOUNT, visit_id: MILTOS_VISIT }, { id: "vl2", account_id: MILTOS_ACCOUNT, visit_id: MILTOS_VISIT },
      { id: "vl-other", account_id: OTHER }],
    visit_brief: [{ id: "vb1", visit_id: MILTOS_VISIT, account_id: MILTOS_ACCOUNT, buddy_call_id: "bc1" }, { id: "vb-other", account_id: OTHER, visit_id: "v-other" }],
    debrief_confirmation: [{ id: "dc1", voice_log_id: "vl1", visit_id: MILTOS_VISIT, buddy_call_id: "bc3", correction_voice_log_id: "vl2" }],
    rep_feedback: [{ id: "rf1", kind: "brief_not_useful", visit_brief_id: "vb1", account_id: MILTOS_ACCOUNT }, { id: "rf2", kind: "debrief_corrected", debrief_confirmation_id: "dc1" },
      { id: "rf-other", kind: "brief_not_useful", account_id: OTHER }],
    buddy_call: [{ id: "bc1", ref_table: "visit_brief", ref_id: "vb1" }, { id: "bc2", ref_table: "visit", ref_id: MILTOS_VISIT }, { id: "bc3", ref_table: "debrief_confirmation", ref_id: "dc1" },
      { id: "bc-other", ref_table: "visit", ref_id: "v-other" }],
    sales_order: [{ id: "seed-order", account_id: MILTOS_ACCOUNT }, { id: "so12", account_id: MILTOS_ACCOUNT, voice_log_id: "vl1" }, { id: "so10", account_id: MILTOS_ACCOUNT, voice_log_id: "vl2" },
      { id: "so-other", account_id: OTHER }],
    order_line: [{ id: "ol12", order_id: "so12" }, { id: "ol10", order_id: "so10" }, { id: "ol-seed", order_id: "seed-order" }],
    task: [{ id: "t1", account_id: MILTOS_ACCOUNT }], problem: [{ id: "seed-problem", account_id: MILTOS_ACCOUNT }],
    activity: [{ id: "a1", account_id: MILTOS_ACCOUNT, visit_id: MILTOS_VISIT }],
    ai_action: [{ id: "ai1", voice_log_id: "vl1", target_table: "problem", target_id: "seed-problem" }, { id: "ai2", target_table: "sales_order", target_id: "so10" },
      { id: "ai-other", target_table: "sales_order", target_id: "so-other" }],
    visit: [{ id: MILTOS_VISIT, account_id: MILTOS_ACCOUNT }],
  };
}

test("cleanup deletes every J5 artefact around Café Miltos and nothing else", () => {
  const d = cleanupPlan(j5Snapshot(), seedIds);
  assert.deepEqual(d.voice_log.sort(), ["vl1", "vl2"]);
  assert.deepEqual(d.visit_brief, ["vb1"]);
  assert.deepEqual(d.debrief_confirmation, ["dc1"]);
  assert.deepEqual(d.rep_feedback.sort(), ["rf1", "rf2"]);
  assert.deepEqual(d.buddy_call.sort(), ["bc1", "bc2", "bc3"]);
  assert.deepEqual(d.sales_order.sort(), ["so10", "so12"]);
  assert.deepEqual(d.order_line.sort(), ["ol10", "ol12"]);
  assert.deepEqual(d.ai_action.sort(), ["ai1", "ai2"]);
  assert.deepEqual(d.task, ["t1"]);
  assert.deepEqual(d.problem, [], "the seed grinder problem is reset by converge, not deleted");
  assert.deepEqual(d.visit, [], "the seed Miltos visit is never deleted");
  const all = DELETE_ORDER.flatMap((t) => d[t]);
  for (const id of ["vl-other", "vb-other", "rf-other", "bc-other", "so-other", "ai-other", "seed-order", "ol-seed"]) assert.ok(!all.includes(id), id);
});

test("cleanup of an already clean environment is empty (re-runs are no-ops)", () => {
  const d = cleanupPlan({ visit: [{ id: MILTOS_VISIT, account_id: MILTOS_ACCOUNT }], sales_order: [{ id: "seed-order", account_id: MILTOS_ACCOUNT }] }, seedIds);
  assert.equal(DELETE_ORDER.reduce((n, t) => n + d[t].length, 0), 0);
});

test("delete order puts children before parents", () => {
  const i = (t: string) => DELETE_ORDER.indexOf(t as never);
  assert.ok(i("order_line") < i("sales_order"));
  assert.ok(i("rep_feedback") < i("debrief_confirmation") && i("debrief_confirmation") < i("voice_log"));
  assert.ok(i("visit_brief") < i("visit") && i("ai_action") < i("voice_log"));
});

test("full reset nulls the columns a J5 run writes on the seed Miltos visit, and only on Miltos rows", () => {
  const seed = withFullReset(loadSeed(contracts, { demoDay: "2026-11-16", tz: "Europe/Athens", wuid: new Proxy({}, { get: (_t, k) => `w-${String(k)}` }) }));
  const visits = seed.find((t) => t.name === "visit")!.rows;
  const v = visits.find((r) => r.id === MILTOS_VISIT)!;
  assert.equal(v.status, "planned");
  assert.equal(v.planned_start_at, "2026-11-16T10:45:00+02:00");
  for (const c of ["outcome", "started_at", "completed_at", "skip_reason"]) assert.equal(v[c], null, c);
  const other = visits.find((r) => r.account_id !== MILTOS_ACCOUNT && r.status === "planned")!;
  assert.ok(!("started_at" in other), "other accounts' rows keep the plain seed diff");
});

test("--next-visit-in moves the visit into the previsit window, today, whole minutes", () => {
  const now = Date.parse("2026-11-16T12:03:20Z"); // 14:03:20 Athens
  const s = shiftVisit(now, 32, "Europe/Athens");
  assert.equal(s.planned_date, "2026-11-16");
  assert.equal(s.planned_start_at, "2026-11-16T12:36:00Z");
  assert.equal(s.brief_due_at, "2026-11-16T12:06:00Z");
  assert.equal(s.brief_by, "2026-11-16T12:10:00Z", "first */5 tick inside the 30 min lead");
  const soon = shiftVisit(now, 10, "Europe/Athens");
  assert.equal(soon.brief_due_at, "2026-11-16T12:03:20Z", "already inside the window: the next tick sends it");
  assert.equal(soon.brief_by, "2026-11-16T12:05:00Z");
  assert.throws(() => shiftVisit(now, 0, "Europe/Athens"), /1\.\.600/);
  assert.throws(() => shiftVisit(Date.parse("2026-11-16T21:40:00Z"), 30, "Europe/Athens"), /another day/);
});

test("arguments: no default env, live phone needs explicit consent, demo-day must be today for a shift", () => {
  const now = Date.parse("2026-11-16T08:00:00Z");
  assert.throws(() => parseArgs([], now), /--env dev\|demo is required/);
  assert.throws(() => parseArgs(["--env", "prod"], now), /--env dev\|demo/);
  assert.throws(() => parseArgs(["--env", "dev", "--next-visit-in", "32"], now), /--live-phone-ok/);
  assert.equal(parseArgs(["--env", "dev", "--next-visit-in", "32", "--dry-run"], now).nextVisitIn, 32);
  assert.equal(parseArgs(["--env", "demo", "--next-visit-in", "32", "--live-phone-ok"], now).liveOk, true);
  assert.throws(() => parseArgs(["--env", "dev", "--demo-day", "2026-11-20", "--next-visit-in", "5", "--dry-run"], now), /today/);
  assert.equal(parseArgs(["--env", "dev"], now).demoDay, "2026-11-16");
});

test("pool keeps order and caps concurrency", async () => {
  let live = 0, peak = 0;
  const out = await pool([5, 1, 4, 2, 3], 2, async (x) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, x)); live--; return x * 10; });
  assert.deepEqual(out, [50, 10, 40, 20, 30]);
  assert.ok(peak <= 2);
});

test("--prompt-now puts the visit end + 10 min just behind now, so the next tick prompts", () => {
  const now = Date.parse("2026-11-16T12:03:20Z");
  const p = promptNow(now, "Europe/Athens", 30);
  assert.equal(p.planned_start_at, "2026-11-16T11:22:00Z", "12:03 - 41 min");
  assert.ok(Date.parse(p.planned_start_at) + 40 * 60_000 <= now, "start + duration + prompt minutes has passed");
  assert.equal(p.prompt_by, "2026-11-16T12:05:00Z");
  assert.throws(() => promptNow(Date.parse("2026-11-15T22:20:00Z"), "Europe/Athens"), /another day/);
  assert.throws(() => parseArgs(["--env", "dev", "--prompt-now"], now), /--live-phone-ok/);
  assert.throws(() => parseArgs(["--env", "dev", "--prompt-now", "--next-visit-in", "5", "--dry-run"], now), /pick one/);
});
