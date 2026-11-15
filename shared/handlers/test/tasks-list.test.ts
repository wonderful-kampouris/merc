import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateResponse } from "../../core/src/index";
import { handle, impl } from "../src/tasks-list";
import { handle as create } from "../src/task-create";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

describe("fn:tasks-list", () => {
  it("a rep sees their own tasks with account names, soonest first", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { status: "open" })));
    expect(validateResponse("tasks-list", r).ok).toBe(true);
    expect(r.items.length).toBe(2);
    expect(r.items.every((x: any) => x.owner_id === IDS.nikos && x.status === "open")).toBe(true);
    expect((r.items[0] as any).title).toBe("Call about delivery");
    expect(r.items.find((x: any) => x.account_name === "Bistro Lofos")).toBeTruthy();
    expect(ok(await handle(t.fnCtx("dimitra", {}))).items).toHaveLength(0);
  });

  it("a manager sees the team; owner_id filters; due_before is exclusive", async () => {
    const t = kit();
    ok(await create(t.fnCtx("eleni", { title: "Manager own" })));
    const all = ok(await handle(t.fnCtx("eleni", {})));
    expect(all.items.map((x: any) => x.owner_id).sort()).toEqual([IDS.eleni, IDS.nikos, IDS.nikos].sort());
    expect(ok(await handle(t.fnCtx("eleni", { owner_id: IDS.nikos }))).items).toHaveLength(2);
    const due = (await t.db.task.require("db3f3061-cb2f-5515-803a-03ea98b2a60d")).due_at!;
    const before = ok(await handle(t.fnCtx("nikos", { due_before: due })));
    expect(before.items.some((x: any) => x.task_id === "db3f3061-cb2f-5515-803a-03ea98b2a60d")).toBe(false);
  });

  it("owner_or_team: a rep cannot list another rep's tasks; spoofed caller ignored", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("dimitra", { owner_id: IDS.nikos })))).toBe("forbidden");
    expect(ok(await handle(t.fnCtx("dimitra", { caller: { user_id: IDS.nikos } }))).items).toHaveLength(0);
  });

  it("paging and the tool path", async () => {
    const t = kit();
    const p = ok(await handle(t.fnCtx("nikos", { page: 2, limit: 1 })));
    expect(p.items).toHaveLength(1);
    expect(p.page).toEqual({ page: 2, limit: 1, total: 2 });
    expect(ok(await runAsTool("tasks-list", impl, t.toolCtx("nikos"), {}, t.key))).toEqual(ok(await handle(t.fnCtx("nikos", {}))));
  });

  it("functions/tasks-list/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "tasks-list", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("tasks-list"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
