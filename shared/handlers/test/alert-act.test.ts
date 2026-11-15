import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsTool } from "../../core/src/index";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, impl, makeImpl } from "../src/alert-act";
import { runAsSystem } from "../../core/src/index";
import { makeImpl as rollup } from "../src/metrics-rollup";
import { makeImpl as engine } from "../src/alerts-engine";

const SEED_NOW = Date.parse("2026-11-16T08:00:00Z");
/** Metrics rollup + alerts engine on the seed at demo day 10:00 Athens. */
async function seededAlerts(t: ReturnType<typeof kit>) {
  ok(await runAsSystem("metrics-rollup", rollup({ now: () => SEED_NOW }), { tables: t.tables, data: {}, orgId: IDS.org }));
  return ok(await runAsSystem("alerts-engine", engine({ now: () => SEED_NOW }), { tables: t.tables, data: {}, orgId: IDS.org }));
}

const NOW = Date.parse("2026-11-16T08:00:00Z");
const LOFOS = "24d14591-c8c2-5885-819a-c5e997f6cad0";
const act = defineFunction("alert-act", makeImpl({ now: () => NOW }));
async function lofosAlert(t: ReturnType<typeof kit>) {
  await seededAlerts(t);
  return (await t.db.alert.findOne({ dedupe_key: `going_quiet:${LOFOS}:2026-11-04` }))!;
}

describe("fn:alert-act", () => {
  it("REQ-ALR-002: plan a visit on the Lofos alert -> 'Visit Bistro Lofos' task tomorrow 09:30, alert done", async () => {
    const t = kit();
    const a = await lofosAlert(t);
    const r = ok(await act(t.fnCtx("nikos", { alert_id: a.id, action: "create_task" })));
    expect(r.alert).toMatchObject({ alert_id: a.id, status: "done", type: "going_quiet" });
    const task = (await t.db.task.get(r.task_id!))!;
    expect(task).toMatchObject({ title: "Visit Bistro Lofos", account_id: LOFOS, owner_id: IDS.nikos, status: "open", source: "human", is_customer_promise: false });
    expect(task.due_at).toBe("2026-11-17T07:30:00.000Z"); // 09:30 Athens (UTC+2)
    expect(r.approval_id).toBeNull();
    // acting again on a done alert is a conflict, not a second task
    expect(errCode(await act(t.fnCtx("nikos", { alert_id: a.id, action: "create_task" })))).toBe("conflict");
  });

  it("other alerts get '<suggested action>: <message>' tasks", async () => {
    const t = kit();
    await seededAlerts(t);
    const deal = (await t.db.alert.findOne({ alert_type_code: "deal_stuck", recipient_id: IDS.nikos }))!;
    const r = ok(await act(t.fnCtx("nikos", { alert_id: deal.id, action: "create_task" })));
    expect((await t.db.task.get(r.task_id!))!.title).toMatch(/^Follow-up email: Deal "/);
  });

  it("scope owner: another rep is refused, an admin may act, unknown alert is not_found", async () => {
    const t = kit();
    const a = await lofosAlert(t);
    expect(errCode(await act(t.fnCtx("dimitra", { alert_id: a.id, action: "dismiss" })))).toBe("forbidden");
    expect(errCode(await act(t.fnCtx("eleni", { alert_id: a.id, action: "dismiss" })))).toBe("forbidden");
    expect(errCode(await act(t.fnCtx("nikos", { alert_id: "00000000-0000-4000-8000-000000000000", action: "done" })))).toBe("not_found");
    expect(ok(await act(t.fnCtx("thanasis", { alert_id: a.id, action: "done" }))).alert.status).toBe("done");
  });

  it("dismiss is idempotent; done after dismiss is a conflict", async () => {
    const t = kit();
    const a = await lofosAlert(t);
    expect(ok(await act(t.fnCtx("nikos", { alert_id: a.id, action: "dismiss" }))).alert.status).toBe("dismissed");
    expect(ok(await act(t.fnCtx("nikos", { alert_id: a.id, action: "dismiss" }))).alert.status).toBe("dismissed");
    expect(errCode(await act(t.fnCtx("nikos", { alert_id: a.id, action: "done" })))).toBe("conflict");
    expect((await t.db.alert.get(a.id))!.resolved_at).toBe(new Date(NOW).toISOString());
  });

  it("create_draft is blocked until fn:draft-message exists, and works through the injected drafter", async () => {
    const t = kit();
    const a = await lofosAlert(t);
    const out = await act(t.fnCtx("nikos", { alert_id: a.id, action: "create_draft" }));
    expect(errCode(out)).toBe("blocked_by_policy");
    expect((out as any).error.details.missing).toBe("fn:draft-message");
    expect((await t.db.alert.get(a.id))!.status).toBe("open");
    const calls: unknown[] = [];
    const withDraft = defineFunction("alert-act", makeImpl({ now: () => NOW, draft: async (args) => { calls.push(args); return { approval_id: "11111111-1111-4111-8111-111111111111", ai_action_id: "22222222-2222-4222-8222-222222222222" }; } }));
    const r = ok(await withDraft(t.fnCtx("nikos", { alert_id: a.id, action: "create_draft" })));
    expect(r).toMatchObject({ approval_id: "11111111-1111-4111-8111-111111111111", task_id: null, alert: { status: "done" } });
    expect(calls[0]).toMatchObject({ account_id: LOFOS, channel: "email", intent: "Visit or call", on_behalf_of: IDS.nikos });
  });

  it("spoofed caller ignored; bad action refused; tool path == function path", async () => {
    const t = kit();
    const a = await lofosAlert(t);
    expect(errCode(await act(t.fnCtx("dimitra", { alert_id: a.id, action: "done", caller: { user_id: IDS.nikos } })))).toBe("forbidden");
    expect(errCode(await act(t.fnCtx("nikos", { alert_id: a.id, action: "explode" })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx(null, { alert_id: a.id, action: "done" })))).toBe("forbidden");
    const viaTool = ok(await runAsTool("alert-act", impl, t.toolCtx("nikos"), { alert_id: a.id, action: "dismiss" }, t.key));
    expect(viaTool.alert.status).toBe("dismissed");
  });

  it("functions/alert-act/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "alert-act", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("alert-act"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
