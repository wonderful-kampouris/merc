import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateResponse } from "../../core/src/index";
import { handle } from "../src/task-assign";
import { kit, ok, errCode, IDS, type Kit } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const acc = async (t: Kit, name: string) => (await t.db.account.findOne({ name }))!.id;

describe("fn:task-assign (REQ-PLN-004)", () => {
  it("Eleni gives Dimitra a task: open, human, owned by Dimitra", async () => {
    const t = kit();
    const pita = await acc(t, "Pita & Psomi");
    const r = ok(await handle(t.fnCtx("eleni", { rep_id: IDS.dimitra, title: "  Bring the new price list  ", account_id: pita, due_at: "2026-11-18T10:00:00+02:00" })));
    expect(validateResponse("task-assign", r).ok).toBe(true);
    expect(await t.db.task.require(r.task_id)).toMatchObject({ owner_id: IDS.dimitra, account_id: pita, title: "Bring the new price list", status: "open", source: "human", is_customer_promise: false });
  });

  it("works without an account or due date", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("eleni", { rep_id: IDS.nikos, title: "Send me your Q4 notes" })));
    expect(await t.db.task.require(r.task_id)).toMatchObject({ account_id: null, due_at: null });
  });

  it("refuses: empty title, a rep caller, a user outside the team, an account outside the rep", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("eleni", { rep_id: IDS.dimitra, title: "   " })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("eleni", { rep_id: IDS.dimitra })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { rep_id: IDS.dimitra, title: "x" })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("eleni", { rep_id: "00000000-0000-4000-8000-000000000000", title: "x" })))).toBe("forbidden");
    expect(["forbidden", "validation_failed"]).toContain(errCode(await handle(t.fnCtx("eleni", { rep_id: IDS.dimitra, title: "x", account_id: await acc(t, "Kolonaki Corner") }))));
    expect(errCode(await handle(t.fnCtx("dimitra", { rep_id: IDS.dimitra, title: "x", caller: { user_id: IDS.eleni } })))).toBe("forbidden");
  });

  it("functions/task-assign/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "task-assign", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("task-assign"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
