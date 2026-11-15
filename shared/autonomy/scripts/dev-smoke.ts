// Dev smoke for REQ-CORE-005/006 on the real dev tables (WP-CORE-03). Runs the SAME handler code that is
// bundled into functions/ai-action-undo and functions/ai-actions-list (defineFunction entries), with the
// platform tables reached through the wful CLI instead of context.tables, and the caller set to a seeded
// Merc user (the CLI user is not one, and the app gate answers 403 to `wful call`).
//
//   node <bundle of this file>            (see scripts/dev-smoke.sh)
//
// Steps, as rep Dimitra (not Nikos: no phone involved anywhere):
//   1. never: propose delete_record -> ai_action "suggested", account untouched
//   2. auto:  propose update_account (email on a seed account) -> applied + snapshots
//   3. auto:  propose create_task -> task inserted
//   4. fn ai-actions-list shows both applied actions as undoable
//   5. fn ai-action-undo on each -> account byte-identical to before (canonicalRow), task deleted
//   6. cleanup: delete the ai_action rows this run created (and the task if undo failed)
import { execFileSync } from "node:child_process";
import { createDb, principalFromFunction, testFilter, type Filter, type OrderBy, type RowEnvelope, type TablesApi } from "../../core/src/index";
import { canonicalRow, propose } from "../src/index";
import { handle as undoFn } from "../../handlers/src/ai-action-undo";
import { handle as listFn } from "../../handlers/src/ai-actions-list";

const WS = "7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464";
const ORG = "97ee94d2-794c-5d47-923d-5616221c9835";
const WUID = "merc-demo-wuid-dimitra";
const ACCOUNT = "ff1e6b56-630d-53ec-944e-c394fcd506e3"; // Ftero Café (seed)

function wful(args: string[]): any {
  const out = execFileSync("wful", ["--profile", "hackathon", "--workspace", WS, "tables", ...args, "--json"], { encoding: "utf8" });
  return out.trim() ? JSON.parse(out) : null;
}
const env = (r: any): RowEnvelope => ({ id: r.id, data: { ...r.data, created_at: r.created_at, updated_at: r.updated_at } });
const unwrap = (res: any) => (res && "id" in res ? res : res?.data ?? res);

/** context.tables over the wful CLI. filter() pages the table and filters in memory (dev tables are small). */
const cli: TablesApi = {
  async getRow(t, id) { return env(unwrap(wful(["row-get", t, id]))); },
  async filter(t, filters: Filter[], limit = 100, offset = 0, orderBy?: OrderBy) {
    const all: RowEnvelope[] = [];
    for (let page = 1; ; page++) {
      const res = wful(["row-list", t, "--limit", "100", "--page", String(page)]);
      all.push(...(res.data as any[]).map(env));
      if (!res.pagination?.has_next_page) break;
    }
    const rows = all.filter((r) => filters.every((f) => testFilter(r.data, f)));
    for (const o of [...(orderBy ?? [])].reverse()) {
      const d = o.direction === "desc" ? -1 : 1;
      rows.sort((a, b) => (a.data[o.column] > b.data[o.column] ? d : a.data[o.column] < b.data[o.column] ? -d : 0));
    }
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  },
  async insert(t, data) { return env(unwrap(wful(["row-insert", t, "--data", JSON.stringify(data)]))); },
  async update(t, id, data) { return env(unwrap(wful(["row-update", t, id, "--data", JSON.stringify(data)]))); },
  async deleteRow(t, id) { wful(["row-delete", t, id, "--force"]); },
  async count(t, filters = []) { return (await this.filter(t, filters, 100000)).total; },
};

const ctx = (data: unknown) => ({ tables: cli, data, metadata: { user: { id: WUID } } });
const log = (step: string, v: unknown) => console.log(`${step}: ${JSON.stringify(v)}`);

async function main() {
  const db = createDb(cli, ORG);
  const me = await principalFromFunction(cli, ctx({}) as never);
  if (me.kind !== "user") throw new Error("seed user not resolved");
  log("caller", { id: me.id, role: me.role });
  const created: string[] = [];
  let taskId: string | null = null;
  try {
    const before = canonicalRow("account", await db.account.require(ACCOUNT));

    const never = await propose(db, me, { code: "delete_record", agent: "buddy", summary: "SMOKE delete Ftero", target: { table: "account", id: ACCOUNT }, apply: async () => { throw new Error("apply must not run"); } });
    created.push(never.ai_action.id);
    log("1 never", { mode: never.mode, status: never.ai_action.status, applied: never.applied, undoable: never.line.undoable });

    const upd = await propose(db, me, { code: "update_account", agent: "buddy", summary: "SMOKE email for Ftero", apply: async (w) => { await w.update("account", ACCOUNT, { email: "smoke@ftero.example.gr" }); return { table: "account", id: ACCOUNT }; } });
    created.push(upd.ai_action.id);
    log("2 auto update_account", { mode: upd.mode, status: upd.ai_action.status, undoable: upd.line.undoable, email_now: (await db.account.require(ACCOUNT)).email });

    const task = await propose(db, me, { code: "create_task", agent: "buddy", summary: "SMOKE task", apply: async (w) => {
      const t = await w.insert("task", { account_id: ACCOUNT, owner_id: me.id, title: "SMOKE autonomy round-trip", is_customer_promise: false, status: "open", source: "ai" });
      return { table: "task", id: t.id };
    } });
    created.push(task.ai_action.id);
    taskId = task.target!.id;
    log("3 auto create_task", { mode: task.mode, status: task.ai_action.status, task_id: taskId });

    const list = await listFn(ctx({ status: "applied", limit: "10" }) as never) as any;
    log("4 fn ai-actions-list", list.error ?? list.items.filter((i: any) => created.includes(i.ai_action_id)).map((i: any) => ({ id: i.ai_action_id, type: i.action_type, status: i.status, undoable: i.undoable })));

    const u1 = await undoFn(ctx({ ai_action_id: upd.ai_action.id }) as never);
    const u2 = await undoFn(ctx({ ai_action_id: task.ai_action.id }) as never);
    log("5 fn ai-action-undo update_account", u1);
    log("5 fn ai-action-undo create_task", u2);
    const after = canonicalRow("account", await db.account.require(ACCOUNT));
    log("5 account byte-identical (all columns + created_at)", JSON.stringify(after) === JSON.stringify(before));
    const t = await db.task.get(taskId);
    log("5 task deleted", t === null);
    if (t === null) taskId = null;
    const again = await undoFn(ctx({ ai_action_id: upd.ai_action.id }) as never);
    log("5 second undo", again);
  } finally {
    if (taskId) await cli.deleteRow("merc.task", taskId).catch(() => undefined);
    for (const id of created) await cli.deleteRow("merc.ai_action", id).catch((e) => console.error(`cleanup ${id} failed`, e));
    log("6 cleanup ai_action rows deleted", created.length);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
