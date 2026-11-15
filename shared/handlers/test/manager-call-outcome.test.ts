import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsSystem, validateResponse } from "../../core/src/index";
import { handle, makeImpl, timeoutStaleCalls } from "../src/manager-call-outcome";
import { makeImpl as requestImpl } from "../src/discount-request";
import { OUTBOUND_PATH } from "../src/discount-check";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const ESPRESSO = "120d56dc-215d-557d-bbab-43d87e1047c4";
const NOW = Date.parse("2026-11-16T10:00:00Z");
const fakeApi = () => { const calls: Array<{ path: string; body: any }> = []; return { calls, post: async (path: string, o?: { body?: unknown }) => { calls.push({ path, body: o?.body }); return path === OUTBOUND_PATH ? { id: "comm-1" } : {}; } }; };

async function liveRequest() {
  const t = kit({ globals: { MERC_APPROVER_CALLER_ID: "+12025550100" } });
  const api = fakeApi();
  const r = ok(await defineFunction("discount-request", requestImpl({ api, now: () => NOW }))(t.fnCtx("nikos", { account_id: IDS.miltos, discount_pct: 8, lines: [{ product_id: ESPRESSO, quantity: 20 }], mode: "live" })));
  expect(r.mode).toBe("live");
  return { t, api, r };
}

describe("fn:manager-call-outcome (REQ-DSC-006)", () => {
  it("voicemail on a live call -> async: due_at from the SLA, requester task, approver push", async () => {
    const { t, api, r } = await liveRequest();
    const out = ok(await defineFunction("manager-call-outcome", makeImpl({ api, now: () => NOW + 30_000 }))(t.fnCtx("eleni", { manager_call_id: r.manager_call_id, outcome: "voicemail", conversation_id: "conv-vm" })));
    expect(validateResponse("manager-call-outcome", out).ok).toBe(true);
    expect(out).toEqual({ approval_id: r.approval_id, fallback: "async" });
    expect(await t.db.manager_call.require(r.manager_call_id!)).toMatchObject({ outcome: "voicemail", wonderful_conversation_id: "conv-vm" });
    expect(await t.db.approval.require(r.approval_id)).toMatchObject({ mode: "async", status: "pending", due_at: new Date(NOW + 30_000 + 3_600_000).toISOString() });
    expect((await t.db.task.all({ owner_id: IDS.nikos, status: "open" })).some((x) => x.title.startsWith("Waiting for Eleni"))).toBe(true);
    expect(api.calls.some((c) => c.body?.channel === `rep:${IDS.eleni}` && c.body?.data?.type === "approval.created")).toBe(true);
  });

  it("answered -> no fallback; a repeated report is idempotent", async () => {
    const { t, r } = await liveRequest();
    const e = defineFunction("manager-call-outcome", makeImpl({ now: () => NOW }));
    expect(ok(await e(t.fnCtx("eleni", { manager_call_id: r.manager_call_id, outcome: "answered" }))).fallback).toBe("none");
    expect((await t.db.approval.require(r.approval_id)).mode).toBe("live");
  });

  it("no outcome within 90 s counts as no answer (lazy timeout), not before", async () => {
    const { t, r } = await liveRequest();
    const db = t.db.withOrg(IDS.org);
    expect(await timeoutStaleCalls(db, t.platform, { now: () => NOW + 60_000 })).toEqual([]);
    expect(await timeoutStaleCalls(db, t.platform, { now: () => NOW + 91_000 })).toEqual([r.manager_call_id]);
    expect((await t.db.manager_call.require(r.manager_call_id!)).outcome).toBe("no_answer");
    expect((await t.db.approval.require(r.approval_id)).mode).toBe("async");
  });

  it("only the requester, approver, admin or a system caller may report", async () => {
    const { t, r } = await liveRequest();
    expect(errCode(await handle(t.fnCtx("dimitra", { manager_call_id: r.manager_call_id, outcome: "busy" })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx(null, { manager_call_id: r.manager_call_id, outcome: "busy" })))).toBe("forbidden");
    const sys = ok(await runAsSystem("manager-call-outcome", makeImpl({ now: () => NOW }), { tables: t.tables, data: { manager_call_id: r.manager_call_id, outcome: "busy" }, orgId: IDS.org, caller: "procedure" }));
    expect(sys.fallback).toBe("async");
  });

  it("functions/manager-call-outcome/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "manager-call-outcome", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("manager-call-outcome"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
