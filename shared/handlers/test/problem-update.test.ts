import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS, DEMO_DAY } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

import { handle, impl } from "../src/problem-update";
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${DEMO_DAY}T08:00:00Z`)); });
afterEach(() => { vi.useRealTimers(); });
const AVRA = "ef86a932-3241-51c8-b7be-1df72dbf74f9";
const idOf = async (t: ReturnType<typeof kit>, name: string) => (await t.db.account.findOne({ name }))!.id;

const GRINDER = "e5198444-d143-5b8d-a174-70391f0aa839"; // Café Miltos, open
describe("fn:problem-update (REQ-CORE-009)", () => {
  it("resolves (sets resolved_at), reopens (clears it) and moves the due date", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { problem_id: GRINDER, status: "resolved" })));
    expect(validateResponse("problem-update", r).ok).toBe(true);
    expect((await t.db.problem.get(GRINDER))!).toMatchObject({ status: "resolved", resolved_at: `${DEMO_DAY}T08:00:00.000Z` });
    ok(await handle(t.fnCtx("nikos", { problem_id: GRINDER, status: "in_progress", due_date: "2026-11-20" })));
    expect((await t.db.problem.get(GRINDER))!).toMatchObject({ status: "in_progress", resolved_at: null, due_date: "2026-11-20" });
    ok(await handle(t.fnCtx("nikos", { problem_id: GRINDER, status: "open", due_date: null })));
    expect((await t.db.problem.get(GRINDER))!.due_date).toBeNull();
  });

  it("validates input against the contract", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", { problem_id: GRINDER, status: "closed" })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { problem_id: GRINDER, status: "open", due_date: "tomorrow" })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { problem_id: "00000000-0000-4000-8000-000000000000", status: "open" })))).toBe("not_found");
  });

  it("scope: a problem of another territory's account is forbidden (app and voice); spoofed caller ignored", async () => {
    const t = kit();
    const kol = await idOf(t, "Kolonaki Corner");
    const p = await t.db.problem.insert({ account_id: kol, description: "test", status: "open" });
    expect(errCode(await handle(t.fnCtx("nikos", { problem_id: p.id, status: "resolved" })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { problem_id: p.id, status: "resolved", caller: { user_id: IDS.thanasis } })))).toBe("forbidden");
    expect(errCode(await runAsTool("problem-update", impl, t.toolCtx("nikos"), { problem_id: p.id, status: "resolved" }, t.key))).toBe("forbidden");
    expect(ok(await runAsTool("problem-update", impl, t.toolCtx("nikos"), { problem_id: GRINDER, status: "in_progress" }, t.key)).problem_id).toBe(GRINDER);
  });

  it("functions/problem-update/handler.gen.js is the current bundle (run `pnpm bundle problem-update` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "problem-update", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("problem-update"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
