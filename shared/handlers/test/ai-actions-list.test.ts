import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { propose, undo } from "../../autonomy/src/index";
import { handle, impl } from "../src/ai-actions-list";
import { kit, ok, errCode, IDS, type Kit, type UserKey } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

/** nikos: applied task + suggested email (pending approval) + undone update; dimitra: one applied note. */
async function seedActions(t: Kit) {
  const as = async (who: UserKey) => t.principal(who);
  const nikos = await as("nikos"), dimitra = await as("dimitra");
  const task = await propose(t.db, nikos, { code: "create_task", agent: "debrief", summary: "Task: bring samples", voice_log_id: null,
    apply: async (w) => ({ table: "task", id: (await w.insert("task", { account_id: IDS.miltos, owner_id: nikos.id, title: "Bring samples", is_customer_promise: true, status: "open", source: "ai" })).id }) });
  const mail = await propose(t.db, nikos, { code: "send_email", agent: "email", summary: "Email Miltos the offer", target: { table: "account", id: IDS.miltos }, apply: async () => null });
  const upd = await propose(t.db, nikos, { code: "update_account", agent: "debrief", summary: "Phone updated",
    apply: async (w) => { await w.update("account", IDS.miltos, { phone: "+30210" }); return { table: "account", id: IDS.miltos }; } });
  await undo(t.db, nikos, upd.ai_action.id);
  const note = await propose(t.db, dimitra, { code: "create_note", agent: "debrief", summary: "Note",
    apply: async (w) => ({ table: "activity", id: (await w.insert("activity", { account_id: IDS.miltos, actor_user_id: dimitra.id, activity_type: "note", source: "ai", body: "x", occurred_at: new Date().toISOString() })).id }) });
  return { task, mail, upd, note };
}

describe("fn:ai-actions-list (REQ-CORE-005)", () => {
  it("a rep sees only actions done on their behalf, as ActionLines with undoable and approval id", async () => {
    const t = kit();
    const s = await seedActions(t);
    const r = ok(await handle(t.fnCtx("nikos")));
    expect(validateResponse("ai-actions-list", r).ok).toBe(true);
    expect(r.page).toEqual({ page: 1, limit: 50, total: 3 });
    const by = new Map(r.items.map((i) => [i.ai_action_id, i]));
    expect(by.has(s.note.ai_action.id)).toBe(false);
    expect(by.get(s.task.ai_action.id)).toMatchObject({ action_type: "create_task", action_class: "internal", status: "applied", undoable: true, target_table: "task", summary: "Task: bring samples" });
    expect(by.get(s.mail.ai_action.id)).toMatchObject({ action_class: "external", status: "suggested", undoable: false, approval_id: s.mail.approval!.id });
    expect(by.get(s.upd.ai_action.id)).toMatchObject({ status: "undone", undoable: false });
  });

  it("manager sees the team; filters by status, user_id and paging", async () => {
    const t = kit();
    const s = await seedActions(t);
    expect(ok(await handle(t.fnCtx("eleni"))).page.total).toBe(4);
    expect(ok(await handle(t.fnCtx("thanasis"))).page.total).toBe(4);
    const applied = ok(await handle(t.fnCtx("eleni", { status: "applied" })));
    expect(applied.items.map((i) => i.ai_action_id).sort()).toEqual([s.task.ai_action.id, s.note.ai_action.id].sort());
    const dim = ok(await handle(t.fnCtx("eleni", { user_id: IDS.dimitra })));
    expect(dim.items.map((i) => i.ai_action_id)).toEqual([s.note.ai_action.id]);
    const p2 = ok(await handle(t.fnCtx("eleni", { page: 2, limit: 3 })));
    expect(p2).toMatchObject({ page: { page: 2, limit: 3, total: 4 } });
    expect(p2.items).toHaveLength(1);
    const future = ok(await handle(t.fnCtx("eleni", { from: "2099-01-01T00:00:00Z" })));
    expect(future.items).toHaveLength(0);
  });

  it("a rep cannot list another rep's actions (REQ-CORE-009); spoofed caller ignored; bad status rejected", async () => {
    const t = kit();
    await seedActions(t);
    expect(errCode(await handle(t.fnCtx("nikos", { user_id: IDS.dimitra })))).toBe("forbidden");
    const spoof = ok(await handle(t.fnCtx("nikos", { caller: { user_id: IDS.thanasis, role: "admin" } })));
    expect(spoof.page.total).toBe(3);
    expect(errCode(await handle(t.fnCtx("nikos", { status: "exploded" })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx(null)))).toBe("forbidden");
  });

  it("GET query strings are coerced (page/limit as text)", async () => {
    const t = kit();
    await seedActions(t);
    const r = ok(await handle(t.fnCtx("nikos", { page: "1", limit: "2" })));
    expect(r.page).toEqual({ page: 1, limit: 2, total: 3 });
  });

  it("the tool path runs the same impl", async () => {
    const t = kit();
    await seedActions(t);
    expect(ok(await runAsTool("ai-actions-list", impl, t.toolCtx("nikos"), {}, t.key))).toEqual(ok(await handle(t.fnCtx("nikos"))));
  });

  it("contract: request validates against spec/contracts/functions/ai-actions-list.json", () => {
    expect(validateRequest("ai-actions-list", { status: "applied", page: 1, limit: 10, voice_log_id: null }).ok).toBe(true);
    expect(validateRequest("ai-actions-list", { bogus: 1 }).ok).toBe(false);
  });

  it("functions/ai-actions-list/handler.gen.js is the current bundle (run `pnpm bundle ai-actions-list` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "ai-actions-list", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("ai-actions-list"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
