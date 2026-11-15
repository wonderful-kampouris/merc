// Removes everything a temporary eval rep created on dev and restores the seeded rows it touched.
//   evals/debrief/run.sh cleanup-dev --rep <temp app_user id> [--dry] [--keep-user]
// 1. every row referencing the rep (voice logs, ai_actions, approvals, message approvals, tasks, activities, signals,
//    exposures, orders + lines, deals + stage history, visits, contacts/problems created by its ai_actions)
// 2. seeded rows (problem, deal, contact, visit of the golden accounts) back to reports/baseline-<rep>.json
// 3. unless --keep-user: the rep's territory_rep rows and the app_user row itself
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { arg, del, flag, rows, update } from "./dev";

const HERE = dirname(fileURLToPath(import.meta.url)).includes("/tmp") ? join(process.cwd(), "evals/debrief") : dirname(fileURLToPath(import.meta.url));
const rep = arg("rep");
if (!rep) throw new Error("--rep is required");
const dry = flag("dry");
const SYSTEM = new Set(["created_at", "updated_at", "id", "code"]);
let n = 0;
const rm = (t: string, id: string) => { n++; console.log(`${dry ? "[dry] " : ""}delete ${t} ${id}`); if (!dry) del(t, id); };

const vls = rows("voice_log").filter((v) => v.rep_id === rep);
const vlIds = new Set(vls.map((v) => v.id));
const ais = rows("ai_action").filter((a) => a.on_behalf_of === rep || vlIds.has(a.voice_log_id));
const aiIds = new Set(ais.map((a) => a.id));
const created: Array<[string, string]> = [];
for (const a of ais) {
  try { const b = JSON.parse(a.before_snapshot_json ?? "null"); for (const r of b?.rows ?? []) if (r.row === null) created.push([r.table, r.id]); } catch { /* not a snapshot */ }
}
const createdSet = new Set(created.map(([t, id]) => `${t}:${id}`));
// debrief confirmations (fn:debrief-confirm-due may create one per completed voice log) and any buddy_call of the rep
for (const d of rows("debrief_confirmation").filter((d) => d.rep_id === rep || vlIds.has(d.voice_log_id))) rm("debrief_confirmation", d.id);
for (const b of rows("buddy_call").filter((b) => b.user_id === rep || b.rep_id === rep)) rm("buddy_call", b.id);
const approvals = rows("approval").filter((a) => a.requested_by === rep || aiIds.has(a.ai_action_id));
const apIds = new Set(approvals.map((a) => a.id));
for (const m of rows("message_approval").filter((m) => apIds.has(m.approval_id))) rm("message_approval", m.id);
for (const a of approvals) rm("approval", a.id);

// child-first order of tables that hold rows the rep created
const orders = rows("sales_order").filter((o) => o.rep_id === rep || vlIds.has(o.voice_log_id));
const oIds = new Set(orders.map((o) => o.id));
for (const l of rows("order_line").filter((l) => oIds.has(l.order_id))) rm("order_line", l.id);
for (const o of orders) rm("sales_order", o.id);
const deals = rows("deal");
const repDeals = new Set(deals.filter((d) => d.owner_id === rep || createdSet.has(`deal:${d.id}`)).map((d) => d.id));
for (const h of rows("deal_stage_history").filter((h) => h.changed_by === rep || repDeals.has(h.deal_id) || createdSet.has(`deal_stage_history:${h.id}`))) rm("deal_stage_history", h.id);
for (const t of rows("task").filter((t) => t.owner_id === rep || vlIds.has(t.voice_log_id))) rm("task", t.id);
for (const s of rows("competitor_signal").filter((s) => s.reported_by === rep || vlIds.has(s.voice_log_id))) rm("competitor_signal", s.id);
for (const e of rows("campaign_exposure").filter((e) => e.rep_id === rep || vlIds.has(e.voice_log_id))) rm("campaign_exposure", e.id);
for (const a of rows("activity").filter((a) => a.actor_user_id === rep || vlIds.has(a.voice_log_id))) rm("activity", a.id);

// seeded rows back to baseline (before deleting the rows the rep created in the same tables)
const basePath = join(HERE, "reports", `baseline-${rep}.json`);
if (existsSync(basePath)) {
  const base = JSON.parse(readFileSync(basePath, "utf8")) as Record<string, Array<Record<string, any>>>;
  for (const [t, list] of Object.entries(base)) {
    const cur = new Map(rows(t).map((r) => [r.id, r]));
    for (const b of list) {
      const c = cur.get(b.id);
      if (!c) { console.log(`WARN baseline ${t} ${b.id} no longer exists`); continue; }
      const patch: Record<string, unknown> = {};
      for (const k of new Set([...Object.keys(b), ...Object.keys(c)])) if (!SYSTEM.has(k) && JSON.stringify(b[k] ?? null) !== JSON.stringify(c[k] ?? null)) patch[k] = b[k] ?? null;
      if (Object.keys(patch).length) { n++; console.log(`${dry ? "[dry] " : ""}restore ${t} ${b.id} ${JSON.stringify(patch)}`); if (!dry) update(t, b.id, patch); }
    }
    // rows of this table the rep created (not in the baseline)
    const ids = new Set(list.map((b) => b.id));
    for (const [table, id] of created) if (table === t && !ids.has(id) && cur.has(id)) rm(t, id);
  }
} else console.log(`WARN no baseline at ${basePath}: seeded rows are not restored`);
for (const id of repDeals) if (createdSet.has(`deal:${id}`) || deals.find((d) => d.id === id)?.owner_id === rep) rm("deal", id);
for (const v of rows("visit").filter((v) => v.rep_id === rep)) rm("visit", v.id);
for (const a of ais) rm("ai_action", a.id);
for (const v of vls) rm("voice_log", v.id);
if (!flag("keep-user")) {
  // fn:briefing-generate (cron) writes a morning briefing for every active rep, the temp rep included
  const brs = rows("briefing").filter((b) => b.rep_id === rep);
  const brIds = new Set(brs.map((b) => b.id));
  for (const i of rows("briefing_item").filter((i) => brIds.has(i.briefing_id))) rm("briefing_item", i.id);
  for (const b of brs) rm("briefing", b.id);
  for (const tr of rows("territory_rep").filter((r) => r.user_id === rep)) rm("territory_rep", tr.id);
  rm("app_user", rep);
}
console.log(`${dry ? "would remove/restore" : "removed/restored"} ${n} row(s)`);
