import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { propose, businessColumns } from "../../autonomy/src/index";
import { handle, impl } from "../src/ai-action-undo";
import { kit, ok, errCode, IDS, type Kit } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

async function applied(t: Kit, who: "nikos" | "dimitra" = "nikos") {
  const me = await t.principal(who);
  const out = await propose(t.db, me, {
    code: "update_account", agent: "debrief", summary: "phone updated",
    apply: async (w) => { await w.update("account", IDS.miltos, { phone: "+302109999999" }); return { table: "account", id: IDS.miltos }; },
  });
  return out.ai_action.id;
}

describe("fn:ai-action-undo (REQ-CORE-006)", () => {
  it("restores the before snapshot exactly through the deployed entry", async () => {
    const t = kit();
    const before = businessColumns(await t.db.account.get(IDS.miltos));
    const id = await applied(t);
    expect((await t.db.account.get(IDS.miltos))!.phone).toBe("+302109999999");
    const r = ok(await handle(t.fnCtx("nikos", { ai_action_id: id })));
    expect(r).toEqual({ ai_action_id: id, status: "undone", restored: { table: "account", id: IDS.miltos } });
    expect(validateResponse("ai-action-undo", r).ok).toBe(true);
    expect(businessColumns(await t.db.account.get(IDS.miltos))).toEqual(before);
    expect((await t.db.ai_action.get(id))).toMatchObject({ status: "undone", undone_by: IDS.nikos });
  });

  it("another rep's action is forbidden (REQ-CORE-009); a spoofed caller is ignored", async () => {
    const t = kit();
    const id = await applied(t);
    expect(errCode(await handle(t.fnCtx("dimitra", { ai_action_id: id })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("dimitra", { ai_action_id: id, caller: { user_id: IDS.nikos, role: "rep" } })))).toBe("forbidden");
    expect((await t.db.ai_action.get(id))!.status).toBe("applied");
    expect(errCode(await handle(t.fnCtx(null, { ai_action_id: id })))).toBe("forbidden");
  });

  it("errors use the Error schema: 404 unknown id, 409 already undone, 422 bad id", async () => {
    const t = kit();
    const id = await applied(t);
    expect(errCode(await handle(t.fnCtx("nikos", { ai_action_id: "00000000-0000-4000-8000-000000000000" })))).toBe("not_found");
    ok(await handle(t.fnCtx("nikos", { ai_action_id: id })));
    expect(errCode(await handle(t.fnCtx("nikos", { ai_action_id: id })))).toBe("conflict");
    expect(errCode(await handle(t.fnCtx("nikos", { ai_action_id: "nope" })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", {})))).toBe("validation_failed");
  });

  it("the buddy tool path runs the same impl", async () => {
    const t = kit();
    const id = await applied(t);
    const r = ok(await runAsTool("ai-action-undo", impl, t.toolCtx("nikos"), { ai_action_id: id }, t.key));
    expect(r.status).toBe("undone");
  });

  it("contract: request validates against spec/contracts/functions/ai-action-undo.json", () => {
    expect(validateRequest("ai-action-undo", { ai_action_id: IDS.miltos }).ok).toBe(true);
    expect(validateRequest("ai-action-undo", { ai_action_id: IDS.miltos, extra: 1 }).ok).toBe(false);
  });

  it("functions/ai-action-undo/handler.gen.js is the current bundle (run `pnpm bundle ai-action-undo` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "ai-action-undo", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("ai-action-undo"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
