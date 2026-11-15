import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateResponse } from "../../core/src/index";
import { handle, impl } from "../src/task-update";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const TASK = "8573da3a-e392-5b66-948b-44c1fb43852d"; // nikos, Bistro Lofos promise

describe("fn:task-update", () => {
  it("the owner marks done, changes the date and title; nulls leave fields unchanged", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { task_id: TASK, status: "done" })));
    expect(validateResponse("task-update", r).ok).toBe(true);
    const before = await t.db.task.require(TASK);
    expect(before.status).toBe("done");
    ok(await handle(t.fnCtx("nikos", { task_id: TASK, status: null, due_at: "2026-11-20T10:00:00.000Z", title: " New title " })));
    expect(await t.db.task.require(TASK)).toMatchObject({ status: "done", due_at: "2026-11-20T10:00:00.000Z", title: "New title" });
    ok(await handle(t.fnCtx("nikos", { task_id: TASK })));
    expect(errCode(await handle(t.fnCtx("nikos", { task_id: TASK, title: "" })))).toBe("validation_failed");
  });

  it("owner_or_team: the manager may update, another rep may not; unknown -> not_found", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("dimitra", { task_id: TASK, status: "cancelled" })))).toBe("forbidden");
    expect((await t.db.task.require(TASK)).status).toBe("open");
    ok(await handle(t.fnCtx("eleni", { task_id: TASK, status: "cancelled" })));
    expect((await t.db.task.require(TASK)).status).toBe("cancelled");
    expect(errCode(await handle(t.fnCtx("nikos", { task_id: "00000000-0000-4000-8000-000000000000" })))).toBe("not_found");
  });

  it("a spoofed caller is ignored; the buddy complete_task tool path works", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("dimitra", { task_id: TASK, status: "done", caller: { user_id: IDS.nikos } })))).toBe("forbidden");
    ok(await runAsTool("task-update", impl, t.toolCtx("nikos"), { task_id: TASK, status: "done" }, t.key));
    expect((await t.db.task.require(TASK)).status).toBe("done");
  });

  it("functions/task-update/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "task-update", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("task-update"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
