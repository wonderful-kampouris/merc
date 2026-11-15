import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, validateRequest, validateResponse } from "../../core/src/index";
import { handle, linkToken, makeImpl } from "../src/approval-decide";
import { handle as request } from "../src/discount-request";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const ESPRESSO = "120d56dc-215d-557d-bbab-43d87e1047c4";
const NOW = Date.parse("2026-11-16T10:30:00Z");
const fakeApi = () => { const calls: Array<{ path: string; body: any }> = []; return { calls, post: async (path: string, o?: { body?: unknown }) => { calls.push({ path, body: o?.body }); return {}; } }; };

async function setup(init: Parameters<typeof kit>[0] = {}, pct = 8) {
  const t = kit(init);
  const r = ok(await request(t.fnCtx("nikos", { account_id: IDS.miltos, discount_pct: pct, lines: [{ product_id: ESPRESSO, quantity: 20 }], mode: "async", conversation_id: "buddy-conv-1" })));
  return { t, r };
}

describe("fn:approval-decide (REQ-DSC-003, REQ-DSC-004, REQ-DSC-005, REQ-DSC-009)", () => {
  it("Eleni counters 6% on 8%: recorded, requester task, push to Nikos + team, event into the buddy conversation", async () => {
    const { t, r } = await setup();
    const api = fakeApi();
    const body = { approval_id: r.approval_id, decision: "counter", approved_pct: 6, note: "6% max this month", via: "app" };
    expect(validateRequest("approval-decide", body).ok).toBe(true);
    const out = ok(await defineFunction("approval-decide", makeImpl({ api, now: () => NOW }))(t.fnCtx("eleni", body)));
    expect(validateResponse("approval-decide", out).ok).toBe(true);
    expect(out).toMatchObject({ requester_notified: true, approval: { status: "countered", approved_pct: 6, requested_pct: 8, decision_note: "6% max this month" } });
    expect(await t.db.approval.require(r.approval_id)).toMatchObject({ status: "countered", decided_by: IDS.eleni, decided_via: "app" });
    const tasks = await t.db.task.all({ owner_id: IDS.nikos, account_id: IDS.miltos });
    expect(tasks.find((x) => x.title.startsWith("Waiting for"))!.status).toBe("done");
    expect(tasks.find((x) => x.title === "Tell Café Miltos: Eleni offered 6%")!.status).toBe("open");
    const pushes = api.calls.filter((c) => c.path.includes("function-sockets")).map((c) => c.body.channel);
    expect(pushes).toEqual([`rep:${IDS.nikos}`, `team:${IDS.eleni}`]);
    expect(api.calls.find((c) => c.path === "/v1/communications/buddy-conv-1/external-events")!.body).toMatchObject({ event_id: `approval:${r.approval_id}`, message: "Eleni offered 6%", trigger_turn: true });
  });

  it("a 9% counter on an 8% request is rejected with validation_failed (REQ-DSC-004)", async () => {
    const { t, r } = await setup();
    const out: any = await handle(t.fnCtx("eleni", { approval_id: r.approval_id, decision: "counter", approved_pct: 9, via: "app" }));
    expect(out.error.code).toBe("validation_failed");
    expect((await t.db.approval.require(r.approval_id)).status).toBe("pending");
  });

  it("counter and approve must stay within the approver's own limit", async () => {
    const { t, r } = await setup();
    await t.db.discount_policy.insert({ org_id: IDS.org, user_id: IDS.eleni, max_discount_pct: 5, active: true });
    expect(errCode(await handle(t.fnCtx("eleni", { approval_id: r.approval_id, decision: "counter", approved_pct: 6, via: "app" })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("eleni", { approval_id: r.approval_id, decision: "approve", via: "app" })))).toBe("validation_failed");
    expect(ok(await handle(t.fnCtx("eleni", { approval_id: r.approval_id, decision: "counter", approved_pct: 5, via: "app" }))).approval.status).toBe("countered");
  });

  it("approve and reject; a second decision conflicts; no service account -> requester_notified false", async () => {
    const a = await setup();
    const out = ok(await handle(a.t.fnCtx("eleni", { approval_id: a.r.approval_id, decision: "approve", via: "phone_call" })));
    expect(out).toMatchObject({ requester_notified: false, approval: { status: "approved", approved_pct: 8 } });
    expect(errCode(await handle(a.t.fnCtx("eleni", { approval_id: a.r.approval_id, decision: "reject", via: "app" })))).toBe("conflict");
    const b = await setup();
    expect(ok(await handle(b.t.fnCtx("eleni", { approval_id: b.r.approval_id, decision: "reject", via: "app" }))).approval).toMatchObject({ status: "rejected", approved_pct: null });
  });

  it("scope: reps lack discounts.approve; a manager who is not the approver is forbidden; admin may decide", async () => {
    const { t, r } = await setup();
    expect(errCode(await handle(t.fnCtx("nikos", { approval_id: r.approval_id, decision: "approve", via: "app" })))).toBe("forbidden");
    await t.db.approval.update(r.approval_id, { approver_id: IDS.thanasis });
    expect(errCode(await handle(t.fnCtx("eleni", { approval_id: r.approval_id, decision: "approve", via: "app" })))).toBe("forbidden");
    expect(ok(await handle(t.fnCtx("thanasis", { approval_id: r.approval_id, decision: "approve", via: "app", caller: { user_id: IDS.eleni } }))).approval.status).toBe("approved");
    expect((await t.db.approval.require(r.approval_id)).decided_by).toBe(IDS.thanasis);
  });

  it("sms_link: blocked until MERC_LINK_SIGNING_KEY exists; then only a valid token passes", async () => {
    const a = await setup();
    const out: any = await handle(a.t.fnCtx("eleni", { approval_id: a.r.approval_id, decision: "approve", via: "sms_link", link_token: "x" }));
    expect(out.error).toMatchObject({ code: "blocked_by_policy", details: { missing: "MERC_LINK_SIGNING_KEY" } });
    const b = await setup({ secrets: { MERC_LINK_SIGNING_KEY: "link-key" } });
    expect(errCode(await handle(b.t.fnCtx("eleni", { approval_id: b.r.approval_id, decision: "approve", via: "sms_link", link_token: "bad" })))).toBe("forbidden");
    const tok = linkToken("link-key", b.r.approval_id, IDS.eleni);
    expect(ok(await handle(b.t.fnCtx("eleni", { approval_id: b.r.approval_id, decision: "approve", via: "sms_link", link_token: tok }))).approval.status).toBe("approved");
  });

  it("functions/approval-decide/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "approval-decide", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("approval-decide"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
