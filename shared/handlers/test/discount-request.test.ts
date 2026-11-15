import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsTool, validateResponse } from "../../core/src/index";
import { handle, makeImpl, startCall } from "../src/discount-request";
import { OUTBOUND_PATH, type DiscountDeps } from "../src/discount-check";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const ESPRESSO = "120d56dc-215d-557d-bbab-43d87e1047c4";
const KOLONAKI = "4cfe45a4-9761-5595-adb2-c1af5a6f2329";
const NOW = Date.parse("2026-11-16T10:00:00Z"); // 12:00 Athens
const LATE = Date.parse("2026-11-16T19:00:00Z"); // 21:00 Athens
const CALLER_ID = { MERC_APPROVER_CALLER_ID: "+12025550100" };
function fakeApi(fail: (path: string) => Error | null = () => null) {
  const calls: Array<{ path: string; body: any }> = [];
  return { calls, post: async (path: string, o?: { body?: unknown }) => { calls.push({ path, body: o?.body }); const e = fail(path); if (e) throw e; return path === OUTBOUND_PATH ? { communication_id: "comm-approver-1" } : {}; } };
}
const logs = () => { const lines: string[] = []; return { lines, log: (_l: string, m: string) => { lines.push(m); } }; };
const entry = (deps: DiscountDeps) => defineFunction("discount-request", makeImpl(deps));
const body = (extra: Record<string, unknown> = {}) => ({ account_id: IDS.miltos, discount_pct: 8, lines: [{ product_id: ESPRESSO, quantity: 20 }], justification: "Competitor offers 10%", mode: "live", ...extra });

describe("fn:discount-request (REQ-DSC-002, REQ-DSC-006, REQ-APV-003)", () => {
  it("live inside call hours: one outbound call to Eleni's own phone with call_purpose carrying the approval id", async () => {
    const t = kit({ globals: CALLER_ID });
    const api = fakeApi();
    const r = ok(await entry({ api, now: () => NOW })(t.fnCtx("nikos", body({ conversation_id: "buddy-conv-1" }))));
    expect(validateResponse("discount-request", r).ok).toBe(true);
    expect(r).toMatchObject({ mode: "live", status: "pending", approver: { id: IDS.eleni }, due_at: null });
    const outbound = api.calls.filter((c) => c.path === OUTBOUND_PATH);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.body).toEqual({ from: "+12025550100", to: "+306900000002", call_purpose: `merc_approval:${r.approval_id}`, answer_timeout_after_progress_seconds: 25 });
    expect(await t.db.manager_call.require(r.manager_call_id!)).toMatchObject({ outcome: "ringing", callee_id: IDS.eleni, attempt_no: 1, wonderful_conversation_id: "comm-approver-1" });
    expect(await t.db.discount_request.findOne({ approval_id: r.approval_id })).toMatchObject({ requested_pct: 8, policy_limit_pct: 3, buddy_conversation_id: "buddy-conv-1" });
    expect(api.calls.find((c) => c.path.includes("function-sockets"))!.body).toMatchObject({ channel: `rep:${IDS.nikos}`, data: { type: "manager_call.status", payload: { outcome: "ringing" } } });
  });

  it("live without a caller id degrades to async with a clear reason: due_at from SLA, task, approver push", async () => {
    const t = kit();
    const api = fakeApi(), L = logs();
    const r = ok(await entry({ api, now: () => NOW, log: L.log as any })(t.fnCtx("nikos", body())));
    expect(r).toMatchObject({ mode: "async", manager_call_id: null, due_at: new Date(NOW + 60 * 60_000).toISOString() });
    expect(api.calls.some((c) => c.path === OUTBOUND_PATH)).toBe(false);
    expect(L.lines.join("\n")).toMatch(/async: live call unavailable: no caller id for merc-approver/);
    expect(await t.db.approval.require(r.approval_id)).toMatchObject({ mode: "async", status: "pending", approver_id: IDS.eleni });
    const task = (await t.db.task.all({ owner_id: IDS.nikos, account_id: IDS.miltos })).find((x) => x.title.startsWith("Waiting for Eleni"));
    expect(task).toMatchObject({ status: "open", source: "ai", title: "Waiting for Eleni: 8% discount for Café Miltos" });
    expect(api.calls.find((c) => c.path.includes("function-sockets"))!.body).toMatchObject({ channel: `rep:${IDS.eleni}`, data: { type: "approval.created" } });
  });

  it("a request at 21:00 becomes async without a call (REQ-APV-003)", async () => {
    const t = kit({ globals: CALLER_ID });
    const api = fakeApi(), L = logs();
    const r = ok(await entry({ api, now: () => LATE, log: L.log as any })(t.fnCtx("nikos", body())));
    expect(r.mode).toBe("async");
    expect(api.calls.some((c) => c.path === OUTBOUND_PATH)).toBe(false);
    expect(L.lines.join("\n")).toMatch(/outside call hours 08:00-20:00/);
  });

  it("no service account, manager_call_enabled=false, or a 503 from the provider -> async", async () => {
    const t1 = kit({ globals: CALLER_ID });
    expect(ok(await entry({ now: () => NOW })(t1.fnCtx("nikos", body()))).mode).toBe("async");
    const t2 = kit({ globals: CALLER_ID });
    await t2.db.organization.update(IDS.org, { manager_call_enabled: false });
    const api2 = fakeApi();
    expect(ok(await entry({ api: api2, now: () => NOW })(t2.fnCtx("nikos", body()))).mode).toBe("async");
    expect(api2.calls.some((c) => c.path === OUTBOUND_PATH)).toBe(false);
    const t3 = kit({ globals: CALLER_ID });
    const api3 = fakeApi((p) => (p === OUTBOUND_PATH ? Object.assign(new Error("outbound_call_unavailable"), { status: 503 }) : null));
    const r3 = ok(await entry({ api: api3, now: () => NOW })(t3.fnCtx("nikos", body())));
    expect(r3.mode).toBe("async");
    expect(await t3.db.manager_call.require(r3.manager_call_id!)).toMatchObject({ outcome: "failed" });
  });

  it("an approver without a valid phone is never dialled; startCall refuses a non-manager callee", async () => {
    const t = kit({ globals: CALLER_ID });
    await t.db.app_user.update(IDS.eleni, { phone: null });
    const api = fakeApi();
    expect(ok(await entry({ api, now: () => NOW })(t.fnCtx("nikos", body()))).mode).toBe("async");
    expect(api.calls.some((c) => c.path === OUTBOUND_PATH)).toBe(false);
    const a = await t.db.approval.insert({ kind: "discount", requested_by: IDS.nikos, approver_id: IDS.dimitra, mode: "live", status: "pending" });
    const s = await startCall(t.db.withOrg(IDS.org), t.platform, { api, now: () => NOW }, a, await t.db.app_user.require(IDS.nikos), await t.db.app_user.require(IDS.dimitra));
    expect(s.ok).toBe(false);
    expect(api.calls.some((c) => c.path === OUTBOUND_PATH)).toBe(false);
  });

  it("12% is above Eleni's own 10%: the approver becomes Thanasis", async () => {
    const t = kit();
    expect(ok(await handle(t.fnCtx("nikos", body({ discount_pct: 12, mode: "async" })))).approver).toMatchObject({ id: IDS.thanasis, role: "admin" });
  });

  it("errors: within the limit, another territory's account, empty lines", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", body({ discount_pct: 3 }))))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", body({ account_id: KOLONAKI }))))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", body({ lines: [] }))))).toBe("validation_failed");
  });

  it("ignores a spoofed caller; the buddy tool path works and keeps the conversation id", async () => {
    const t = kit();
    const viaFn = ok(await handle(t.fnCtx("nikos", { ...body({ mode: "async" }), caller: { user_id: IDS.thanasis } })));
    expect((await t.db.approval.require(viaFn.approval_id)).requested_by).toBe(IDS.nikos);
    const viaTool = ok(await runAsTool("discount-request", makeImpl({}), t.toolCtx("nikos"), body({ mode: "async", conversation_id: "conv-9" }), t.key));
    expect(viaTool.mode).toBe("async");
    expect((await t.db.discount_request.findOne({ approval_id: viaTool.approval_id }))!.buddy_conversation_id).toBe("conv-9");
  });

  it("functions/discount-request/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "discount-request", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("discount-request"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
