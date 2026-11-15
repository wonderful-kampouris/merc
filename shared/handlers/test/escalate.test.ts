import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl, FALLBACK_TYPE } from "../src/escalate";
import { handle as listTasks } from "../src/tasks-list";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

describe("fn:escalate (REQ-BUD-011)", () => {
  it("'tell my manager': Eleni gets a task linked to the account, plus an open alert with the context", async () => {
    const t = kit();
    const body = { account_id: IDS.miltos, reason: "Owner wants a credit extension" };
    expect(validateRequest("escalate", body).ok).toBe(true);
    const r = ok(await handle(t.fnCtx("nikos", body)));
    expect(validateResponse("escalate", r).ok).toBe(true);
    const task = await t.db.task.require(r.task_id);
    expect(task).toMatchObject({ owner_id: IDS.eleni, account_id: IDS.miltos, status: "open" });
    expect(task.title).toContain("Café Miltos");
    expect(task.title).toContain("credit extension");
    expect(Date.parse(task.due_at!)).toBeGreaterThan(Date.now() - 86_400_000);
    const alert = await t.db.alert.require(r.alert_id);
    expect(alert).toMatchObject({ recipient_id: IDS.eleni, account_id: IDS.miltos, task_id: task.id, status: "open", severity: "high", alert_type_code: FALLBACK_TYPE, territory_id: IDS.north });
    expect(alert.message).toMatch(/escalated Café Miltos: Owner wants a credit extension/);
    // it shows up in Eleni's task list
    const mine = ok(await listTasks(t.fnCtx("eleni", { owner_id: IDS.eleni })));
    expect(mine.items.some((x: any) => x.task_id === r.task_id && x.account_name === "Café Miltos")).toBe(true);
  });

  it("uses the 'escalation' alert type once it exists", async () => {
    const t = kit();
    t.tables.load("alert_type", [{ code: "escalation", default_severity: "high", suggested_action: "Call the rep", description: "rep escalation" }]);
    const r = ok(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, reason: "x" })));
    expect((await t.db.alert.require(r.alert_id)).alert_type_code).toBe("escalation");
  });

  it("errors: empty reason, out-of-scope account, no manager; a failed alert leaves no task", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, reason: "  " })))).toBe("validation_failed");
    const center = (await t.db.account.all({ territory_id: IDS.center }))[0]!;
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: center.id, reason: "x" })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("thanasis", { account_id: IDS.miltos, reason: "x" })))).toBe("not_found");
    const tasks = await t.db.task.count();
    const real = t.tables.insert.bind(t.tables);
    (t.tables as any).insert = async (q: string, d: any) => { if (q.endsWith(".alert")) throw Object.assign(new Error("boom"), { status: 502 }); return real(q, d); };
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, reason: "x" })))).toBe("upstream_failed");
    expect(await t.db.task.count()).toBe(tasks);
  });

  it("a spoofed caller is ignored; the buddy escalate_to_manager tool path works", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, reason: "x", caller: { user_id: IDS.thanasis } })));
    expect((await t.db.task.require(r.task_id)).owner_id).toBe(IDS.eleni);
    const v = ok(await runAsTool("escalate", impl, t.toolCtx("nikos"), { account_id: IDS.miltos, reason: "via buddy" }, t.key));
    expect((await t.db.alert.require(v.alert_id)).recipient_id).toBe(IDS.eleni);
  });

  it("functions/escalate/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "escalate", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("escalate"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
