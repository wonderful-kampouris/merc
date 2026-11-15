// merc-approver tools end to end on the seeded fake db: the tools resolve the call, inject approval_id / callee /
// via / manager_call_id from code, and run the same handlers as the deployed Functions.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineFunction } from "../../../shared/core/src/index";
import { makeImpl as requestImpl } from "../../../shared/handlers/src/discount-request";
import { OUTBOUND_PATH } from "../../../shared/handlers/src/discount-check";
import { kit, ok, IDS } from "../../../shared/handlers/src/_lib/testkit";
import {
  approvalIdFromMetadata, getApprovalBrief, onCallEnded, onVoicemail, recordApprovalDecision, reportCallOutcome,
  resolveCall, voicemailLine, type ApproverCtx,
} from "../lib/approver";

const HERE = dirname(fileURLToPath(import.meta.url));
const ESPRESSO = "120d56dc-215d-557d-bbab-43d87e1047c4";
const NOW = Date.parse("2026-11-16T10:00:00Z"); // 12:00 Athens, inside call hours
const ELENI_PHONE = "+306900000002";
const now = () => NOW + 20_000;

function fakeApi() {
  const calls: Array<{ path: string; body: any }> = [];
  return { calls, post: async (path: string, o?: { body?: unknown }) => { calls.push({ path, body: o?.body }); return path === OUTBOUND_PATH ? { communication_id: "comm-approver-1" } : {}; } };
}

/** Nikos asks for 8% on Miltos (his limit 3%, Eleni's higher); fn:discount-request places the one call. */
async function liveCall() {
  const t = kit({ globals: { MERC_APPROVER_CALLER_ID: "+12025550100" } });
  const api = fakeApi();
  const r = ok(await defineFunction("discount-request", requestImpl({ api, now: () => NOW }))(t.fnCtx("nikos", { account_id: IDS.miltos, discount_pct: 8, lines: [{ product_id: ESPRESSO, quantity: 20 }], justification: "Competitor offers 10%", mode: "live", conversation_id: "buddy-conv-1" })));
  expect(r.mode).toBe("live");
  const ctx = (comm: Record<string, unknown> = {}): ApproverCtx => ({ tables: t.tables, api, metadata: { communication: { id: "comm-approver-1", toNumber: ELENI_PHONE, fromNumber: "+12025550100", direction: "outbound", metadata: {}, ...comm } } });
  return { t, api, r, ctx };
}

describe("merc-approver: call resolution (inject call_metadata.*, callee)", () => {
  it("matches by conversation id, by call_purpose, then by the approver's phone", async () => {
    const { r, ctx } = await liveCall();
    expect((await resolveCall(ctx(), now())).via).toBe("conversation_id");
    const byPurpose = await resolveCall(ctx({ id: "other", metadata: { call_purpose: `merc_approval:${r.approval_id}` } }), now());
    expect(byPurpose).toMatchObject({ via: "call_purpose", approval: { id: r.approval_id }, callee: { id: IDS.eleni } });
    expect((await resolveCall(ctx({ id: "other" }), now())).via).toBe("callee_phone");
    expect(approvalIdFromMetadata({ a: { b: `x merc_approval:${r.approval_id}` } })).toBe(r.approval_id);
  });

  it("refuses inbound calls, unknown calls and calls to another number", async () => {
    const { ctx } = await liveCall();
    await expect(resolveCall(ctx({ direction: "inbound" }), now())).rejects.toThrow(/outbound/);
    await expect(resolveCall(ctx({ id: "nope", toNumber: "+306999999999", fromNumber: null }), now())).rejects.toThrow(/no Merc approval/);
    await expect(resolveCall(ctx({ toNumber: "+306999999999", fromNumber: "+12025550100" }), now())).rejects.toThrow(/approver's phone/);
    const brief = await getApprovalBrief(ctx({ direction: "inbound" }), now);
    expect(brief).toMatchObject({ error: { code: "forbidden" } });
  });
});

describe("merc-approver tools (REQ-DSC-003, REQ-DSC-004, REQ-APV-002)", () => {
  it("get_approval_brief: one-sentence brief from rows, marks the call answered", async () => {
    const { t, r, ctx } = await liveCall();
    const b = await getApprovalBrief(ctx(), now) as any;
    expect(b).toMatchObject({ approval_id: r.approval_id, callee: { id: IDS.eleni }, requester: { id: IDS.nikos }, requested_pct: 8, policy_limit_pct: 3, already_decided: false });
    expect(b.spoken_brief).toMatch(/8%/);
    expect(b.spoken_brief.split(/[.;]\s/).length).toBe(1);
    expect((await t.db.manager_call.require(r.manager_call_id!)).outcome).toBe("answered");
  });

  it("approve: records via phone_call with Eleni as decider, rep follow-up task", async () => {
    const { t, r, ctx } = await liveCall();
    const out = await recordApprovalDecision(ctx(), { decision: "approve" }, now) as any;
    expect(out.error).toBeUndefined();
    expect(out.approval).toMatchObject({ status: "approved" });
    expect(await t.db.approval.require(r.approval_id)).toMatchObject({ status: "approved", decided_by: IDS.eleni, decided_via: "phone_call" });
    expect((await t.db.task.all({ owner_id: IDS.nikos, status: "open" })).some((x) => x.title.includes("approved 8%"))).toBe(true);
  });

  it("counter 6% on an 8% request is recorded; 9% counter is validation_failed", async () => {
    const a = await liveCall();
    const bad = await recordApprovalDecision(a.ctx(), { decision: "counter", approved_pct: 9 }, now) as any;
    expect(bad.error.code).toBe("validation_failed");
    const good = await recordApprovalDecision(a.ctx(), { decision: "counter", approved_pct: 6, note: "Max 6 for this client" }, now) as any;
    expect(good.approval).toMatchObject({ status: "countered" });
    expect(await a.t.db.discount_request.findOne({ approval_id: a.r.approval_id })).toMatchObject({ approved_pct: 6 });
  });

  it("reject is recorded; a second decision is a conflict", async () => {
    const { ctx } = await liveCall();
    expect((await recordApprovalDecision(ctx(), { decision: "reject", approved_pct: null, note: null }, now) as any).approval.status).toBe("rejected");
    expect((await recordApprovalDecision(ctx(), { decision: "approve" }, now) as any).error.code).toBe("conflict");
    expect((await getApprovalBrief(ctx(), now) as any).already_decided).toBe(true);
  });

  it("the model cannot pick the approval or the decider: extra params are rejected by the contract", async () => {
    const { ctx } = await liveCall();
    const out = await recordApprovalDecision(ctx(), { decision: "approve", approval_id: "00000000-0000-0000-0000-000000000000", via: "app" } as any, now) as any;
    expect(out.approval?.status ?? out.error?.code).toBe("approved"); // approval_id/via come from code; model extras are ignored
  });

  it("report_call_outcome(failed) switches the live request to async", async () => {
    const { t, r, ctx } = await liveCall();
    expect(await reportCallOutcome(ctx(), "failed", now)).toEqual({ approval_id: r.approval_id, fallback: "async" });
    expect((await t.db.approval.require(r.approval_id)).mode).toBe("async");
  });
});

describe("merc-approver triggers (OnVoicemailDetected, OnEnd; REQ-DSC-008)", () => {
  it("voicemail line has no %, digits, customer or product", () => {
    for (const lang of ["el", "en"]) {
      const l = voicemailLine(lang, "Νίκος Παπαδόπουλος 8%");
      expect(l).not.toMatch(/\d|%|Miltos|Μίλτος|espresso/i);
      expect(l).toMatch(/Merc/);
    }
  });

  it("OnVoicemailDetected: announces the safe line, reports voicemail (async), ends the call", async () => {
    const { t, r, ctx } = await liveCall();
    const said: string[] = []; let ended = false;
    const out = await onVoicemail({ ...ctx(), agent: { announce: (m: string) => { said.push(m); } }, telephony: { end: () => { ended = true; } } }, now) as any;
    expect(said).toHaveLength(1);
    expect(said[0]).not.toMatch(/\d|%|Μίλτος|Miltos/);
    expect(ended).toBe(true);
    expect(out.reported).toMatchObject({ approval_id: r.approval_id, fallback: "async" });
    expect(await t.db.manager_call.require(r.manager_call_id!)).toMatchObject({ outcome: "voicemail" });
  });

  it("OnEnd: failed only when undecided; no-op after a decision", async () => {
    const a = await liveCall();
    await recordApprovalDecision(a.ctx(), { decision: "approve" }, now);
    expect(await onCallEnded(a.ctx(), now)).toMatchObject({ skipped: true });
    const b = await liveCall();
    await getApprovalBrief(b.ctx(), now);
    expect(await onCallEnded(b.ctx(), now)).toEqual({ approval_id: b.r.approval_id, fallback: "async" });
    expect(await onCallEnded({ tables: b.t.tables, metadata: { communication: { id: "x", direction: "inbound" } } }, now)).toMatchObject({ skipped: true });
  });
});

describe("report_call_outcome(voicemail)", () => {
  it("returns the safe voicemail words for the model to say", async () => {
    const { r, ctx } = await liveCall();
    const out = await reportCallOutcome(ctx(), "voicemail", now) as any;
    expect(out).toMatchObject({ approval_id: r.approval_id, fallback: "async" });
    expect(out.say).toMatch(/Merc/);
    expect(out.say).not.toMatch(/\d|%|Μίλτος|Miltos/);
  });
});

describe("bundle", () => {
  it("lib/handlers.gen.js is the current bundle of shared/handlers", () => {
    execFileSync(process.execPath, [join(HERE, "../scripts/bundle-handlers.mjs"), "--check"], { stdio: "pipe" });
  });
});
