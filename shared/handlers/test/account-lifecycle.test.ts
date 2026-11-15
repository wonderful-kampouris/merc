import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsSystem, validateResponse } from "../../core/src/index";
import { kit, ok, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { makeImpl as rollup } from "../src/metrics-rollup";
import { handle, lostAfterDays, makeImpl, undoMarkAccountLost } from "../src/account-lifecycle";

const NOW = Date.parse("2026-11-16T08:00:00Z");
const OLD_MILL = "897adb7c-9ee9-5102-a63a-19151c264052";
const LOFOS = "24d14591-c8c2-5885-819a-c5e997f6cad0";
const sys = (t: ReturnType<typeof kit>, data: unknown = {}) => runAsSystem("account-lifecycle", makeImpl({ now: () => NOW }), { tables: t.tables, data, orgId: IDS.org });
/** The seed already shows Old Mill as lost; put it back to customer so the rule has something to do. */
async function prepared() {
  const t = kit();
  await t.db.account.update(OLD_MILL, { account_type: "customer" });
  ok(await runAsSystem("metrics-rollup", rollup({ now: () => NOW }), { tables: t.tables, data: {}, orgId: IDS.org }));
  return t;
}

describe("fn:account-lifecycle", () => {
  it("lost limit is max(60, multiplier x avg)", () => {
    expect(lostAfterDays(8, 3)).toBe(60);
    expect(lostAfterDays(30, 3)).toBe(90);
  });

  it("REQ-ALR-005: Old Mill Café (95 days quiet, limit 60) becomes lost through an applied ai_action", async () => {
    const t = await prepared();
    const r = ok(await sys(t));
    expect(validateResponse("account-lifecycle", r).ok).toBe(true);
    const marked = (r.details as any).marked as any[];
    expect(marked.map((m) => m.account_id)).toEqual([OLD_MILL]);
    expect(marked[0]).toMatchObject({ days: 95, limit: 60, status: "applied" });
    expect((await t.db.account.get(OLD_MILL))!.account_type).toBe("lost");
    expect((await t.db.account.get(LOFOS))!.account_type).toBe("customer");
    const a = (await t.db.ai_action.get(marked[0].ai_action_id))!;
    expect(a).toMatchObject({ agent: "lifecycle", action_type_code: "mark_account_lost", on_behalf_of: IDS.nikos, target_table: "account", target_id: OLD_MILL, status: "applied" });
    expect(JSON.parse(a.before_snapshot_json!).rows[0].row.account_type).toBe("customer");
    expect(JSON.parse(a.after_snapshot_json!).rows[0].row.account_type).toBe("lost");
  });

  it("undo restores Old Mill to customer, and the next run does not re-mark it for the same gap", async () => {
    const t = await prepared();
    const id = ((ok(await sys(t)).details as any).marked[0].ai_action_id) as string;
    const nikos = await t.principal("nikos");
    expect(await undoMarkAccountLost(t.db, nikos, id, NOW)).toEqual({ ai_action_id: id, status: "undone", restored: { table: "account", id: OLD_MILL } });
    expect((await t.db.account.get(OLD_MILL))!.account_type).toBe("customer");
    expect((await t.db.ai_action.get(id))!).toMatchObject({ status: "undone", undone_by: IDS.nikos });
    const again = ok(await sys(t));
    expect(again.created).toBe(0);
    expect((await t.db.account.get(OLD_MILL))!.account_type).toBe("customer");
  });

  it("only the owner (or admin) may undo; undoing twice is a conflict", async () => {
    const t = await prepared();
    const id = ((ok(await sys(t)).details as any).marked[0].ai_action_id) as string;
    await expect(undoMarkAccountLost(t.db, await t.principal("dimitra"), id)).rejects.toMatchObject({ code: "forbidden" });
    await undoMarkAccountLost(t.db, await t.principal("thanasis"), id);
    await expect(undoMarkAccountLost(t.db, await t.principal("thanasis"), id)).rejects.toMatchObject({ code: "conflict" });
  });

  it("ai_permission never/ask -> stored as suggested, account untouched", async () => {
    const t = await prepared();
    const p = (await t.db.ai_permission.findOne({ role_code: "rep", action_type_code: "mark_account_lost" }))!;
    await t.db.ai_permission.update(p.id, { mode: "never" });
    const r = ok(await sys(t));
    expect((r.details as any).marked[0].status).toBe("suggested");
    expect((await t.db.account.get(OLD_MILL))!.account_type).toBe("customer");
    expect(ok(await sys(t)).created).toBe(0);
  });

  it("on the untouched seed nothing changes (Old Mill is already lost); dry_run writes nothing", async () => {
    const t = kit();
    ok(await runAsSystem("metrics-rollup", rollup({ now: () => NOW }), { tables: t.tables, data: {}, orgId: IDS.org }));
    expect(ok(await sys(t)).created).toBe(0);
    const t2 = await prepared();
    expect(ok(await sys(t2, { dry_run: true })).created).toBe(1);
    expect((await t2.db.account.get(OLD_MILL))!.account_type).toBe("customer");
    expect((await t2.db.ai_action.all()).length).toBe(0);
    expect(await handle({ tables: t2.tables, data: { dry_run: true }, metadata: {} } as never)).toMatchObject({ orgs: 1, failed: 0 });
  });

  it("functions/account-lifecycle/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "account-lifecycle", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("account-lifecycle"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
