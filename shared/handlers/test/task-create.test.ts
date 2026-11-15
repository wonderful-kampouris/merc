import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl } from "../src/task-create";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const DEAL = "50bce864-2842-50e6-8615-503cf2fe5c6f"; // on Café Miltos

describe("fn:task-create", () => {
  it("creates an open human task owned by the caller; response matches the contract", async () => {
    const t = kit();
    const body = { title: " Send price list ", due_at: "2026-11-17T09:00:00.000Z", account_id: IDS.miltos, is_customer_promise: true };
    expect(validateRequest("task-create", body).ok).toBe(true);
    const r = ok(await handle(t.fnCtx("nikos", body)));
    expect(validateResponse("task-create", r).ok).toBe(true);
    expect(r.ai_action_id).toBeNull();
    expect(await t.db.task.require(r.task_id)).toMatchObject({ owner_id: IDS.nikos, title: "Send price list", status: "open", source: "human", is_customer_promise: true, account_id: IDS.miltos });
  });

  it("a deal fills in its account; a mismatched account is rejected", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { title: "Follow up", deal_id: DEAL })));
    expect(await t.db.task.require(r.task_id)).toMatchObject({ deal_id: DEAL, account_id: IDS.miltos, is_customer_promise: false });
    expect(errCode(await handle(t.fnCtx("nikos", { title: "x", deal_id: DEAL, account_id: "24d14591-c8c2-5885-819a-c5e997f6cad0" })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { title: "   " })))).toBe("validation_failed");
  });

  it("scope: an out-of-scope account is forbidden; a spoofed caller is ignored", async () => {
    const t = kit();
    const center = (await t.db.account.all({ territory_id: IDS.center }))[0]!;
    expect(errCode(await handle(t.fnCtx("nikos", { title: "x", account_id: center.id })))).toBe("forbidden");
    const r = ok(await handle(t.fnCtx("nikos", { title: "mine", caller: { user_id: IDS.eleni } })));
    expect((await t.db.task.require(r.task_id)).owner_id).toBe(IDS.nikos);
  });

  it("the buddy create_task tool path runs the same impl", async () => {
    const t = kit();
    const r = ok(await runAsTool("task-create", impl, t.toolCtx("nikos"), { title: "Call back", account_id: IDS.miltos }, t.key));
    expect((await t.db.task.require(r.task_id)).owner_id).toBe(IDS.nikos);
  });

  it("functions/task-create/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "task-create", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("task-create"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
