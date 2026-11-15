import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, validateRequest, validateResponse } from "../../core/src/index";
import { OUTBOUND_PATH, TEMPLATES, makeImpl as startImpl } from "../src/buddy-call-start";
import { buddyCallIdFrom, closeCallFromSession, handle, makeImpl, openCallFromSession, reportFromSession, reportOutcomeTool, timeoutStaleCalls } from "../src/buddy-call-outcome";
import { kit, ok, errCode, IDS, type Kit } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const NOW = Date.parse("2026-11-16T10:00:00Z");
const NIKOS_PHONE = "+306900000003";
const BUDDY = "+18455133803";
const fakeApi = () => { const calls: Array<{ path: string; body: any }> = []; return { calls, post: async (path: string, o?: { body?: unknown }) => { calls.push({ path, body: o?.body }); return path === OUTBOUND_PATH ? { id: "comm-out-1" } : {}; } }; };
const fakeOutbound = () => { const sent: any[] = []; return { sent, whatsapp: { sendTemplate: (o: any) => { sent.push(o); return "ok"; }, sendInteractive: (o: any) => { sent.push(o); return "ok"; } } }; };

/** A started outbound buddy call to Nikos (live config, fake api). */
async function startedCall(globals: Record<string, unknown> = {}) {
  const t = kit({ globals: { MERC_BUDDY_NUMBER: BUDDY, MERC_CHANNELS_LIVE: true, ...globals } });
  const api = fakeApi();
  const r = ok(await defineFunction("buddy-call-start", startImpl({ api, now: () => NOW }) as any)(t.fnCtx("nikos", { purpose: "approval_decided", reason: "Eleni approved 8% for Fournos Kostas.", ref_table: "approval", ref_id: "a-1" })));
  expect(r.status).toBe("started");
  return { t, api, id: r.buddy_call_id as string };
}
const outcome = (t: Kit, deps: any, body: unknown, who: "nikos" | "eleni" | "thanasis" = "nikos") => defineFunction("buddy-call-outcome", makeImpl({ now: () => NOW + 30_000, ...deps }) as any)(t.fnCtx(who, body));
/** The outbound phone session of that call, as the platform builds it (identity = toNumber). */
const outboundSession = (t: Kit, extra: Record<string, unknown> = {}) => ({ tables: t.tables, secrets: t.platform.secrets, globals: t.platform.globals, metadata: { communication: { id: "comm-out-1", type: "voice", direction: "outbound", fromNumber: BUDDY, toNumber: NIKOS_PHONE, metadata: {}, ...extra } } }) as any;

describe("call opening/closing triggers (\"call me\" callback)", () => {
  /** A started "call me" callback whose outbound response carried no conversation id. */
  async function startedCallback() {
    const t = kit({ globals: { MERC_BUDDY_NUMBER: BUDDY, MERC_CHANNELS_LIVE: true } });
    const api = { calls: [] as any[], post: async (path: string, o?: { body?: unknown }) => { api.calls.push({ path, body: o?.body }); return {}; } };
    const run = () => defineFunction("buddy-call-start", startImpl({ api, now: () => NOW }) as any)(t.fnCtx("nikos", { purpose: "callback" }));
    const r = ok(await run());
    expect(r).toMatchObject({ status: "started", channel: "call" });
    return { t, api, run, id: r.buddy_call_id as string };
  }

  it("OnStart finds the row by rep + recent start, marks it answered and says why we called", async () => {
    const { t, id } = await startedCallback();
    const open = await openCallFromSession(outboundSession(t, { id: "comm-cb-1" }), t.key, { now: () => NOW + 15_000 });
    expect(open).toEqual({ kind: "buddy_call", buddy_call_id: id, purpose: "callback", reason: null, first_name: "Nikos" });
    const row = await t.db.buddy_call.require(id);
    expect(row).toMatchObject({ status: "answered", wonderful_conversation_id: "comm-cb-1" });
    expect(row.ended_at ?? null).toBeNull();
  });

  it("OnEnd sets ended_at on the answered call; a second \"call me\" then places a new call", async () => {
    const { t, api, run, id } = await startedCallback();
    await openCallFromSession(outboundSession(t, { id: "comm-cb-1" }), t.key, { now: () => NOW + 15_000 });
    expect(await closeCallFromSession(outboundSession(t, { id: "comm-cb-1" }), t.key, { now: () => NOW + 90_000 })).toEqual({ buddy_call_id: id, status: "answered", ended: true });
    expect((await t.db.buddy_call.require(id)).ended_at).toBe(new Date(NOW + 90_000).toISOString());
    const again = ok(await run());
    expect(again.buddy_call_id).not.toBe(id);
    expect(api.calls.filter((c) => c.path === OUTBOUND_PATH)).toHaveLength(2);
  });

  it("OnEnd on a call nobody answered reports no_answer; inbound sessions open with the greeting", async () => {
    const { t, id } = await startedCallback();
    expect(await closeCallFromSession(outboundSession(t), t.key, { now: () => NOW + 60_000 })).toMatchObject({ buddy_call_id: id });
    expect((await t.db.buddy_call.require(id)).status).toBe("no_answer");
    expect(await openCallFromSession(outboundSession(t, { direction: "inbound", fromNumber: NIKOS_PHONE }), t.key)).toEqual({ kind: "inbound" });
  });

  it("a row older than the match window is not claimed", async () => {
    const { t } = await startedCallback();
    expect(await openCallFromSession(outboundSession(t, { id: "late" }), t.key, { now: () => NOW + 6 * 60_000 })).toEqual({ kind: "inbound" });
  });
});

describe("fn:buddy-call-outcome (REQ-BUD-015)", () => {
  it("voicemail + WhatsApp configured -> exactly one merc_buddy_ping, no call retry; contract shapes", async () => {
    const { t, api, id } = await startedCall({ MERC_WHATSAPP_CONNECTION: "Merc WA" });
    const outbound = fakeOutbound();
    const body = { buddy_call_id: id, outcome: "voicemail", conversation_id: "comm-out-1" };
    expect(validateRequest("buddy-call-outcome", body).ok).toBe(true);
    const out = ok(await outcome(t, { api, outbound }, body));
    expect(validateResponse("buddy-call-outcome", out).ok).toBe(true);
    expect(out).toEqual({ buddy_call_id: id, fallback: "whatsapp" });
    expect(outbound.sent).toHaveLength(1);
    expect(outbound.sent[0]).toMatchObject({ destination: NIKOS_PHONE, templateName: TEMPLATES.ping, templateParams: ["Nikos", "Eleni approved 8% for Fournos Kostas."] });
    expect(api.calls.filter((c) => c.path === OUTBOUND_PATH)).toHaveLength(1); // the original call only
    expect((await t.db.buddy_call.require(id)).status).toBe("voicemail");
    // a repeated report sends nothing more
    expect(ok(await outcome(t, { api, outbound }, body)).fallback).toBe("none");
    expect(outbound.sent).toHaveLength(1);
  });

  it("no_answer without WhatsApp -> push + inbox task", async () => {
    const { t, api, id } = await startedCall();
    const out = ok(await outcome(t, { api }, { buddy_call_id: id, outcome: "no_answer" }));
    expect(out.fallback).toBe("app");
    expect((await t.db.task.all({ owner_id: IDS.nikos, status: "open" })).some((x) => x.title.includes("Eleni approved 8%"))).toBe(true);
    expect(api.calls.some((c) => c.body?.data?.type === "buddy_call.status")).toBe(true);
  });

  it("WhatsApp configured but MERC_CHANNELS_LIVE false at fallback time -> app fallback (nothing sent)", async () => {
    const { t, api, id } = await startedCall({ MERC_WHATSAPP_CONNECTION: "Merc WA" });
    const outbound = fakeOutbound();
    const t2 = { ...t, fnCtx: (who: any, body: any) => ({ ...t.fnCtx(who, body), globals: { get: (n: string) => (n === "MERC_CHANNELS_LIVE" ? false : n === "MERC_WHATSAPP_CONNECTION" ? "Merc WA" : null) } }) } as any;
    const out = ok(await outcome(t2, { api, outbound }, { buddy_call_id: id, outcome: "busy" }));
    expect(out.fallback).toBe("app");
    expect(outbound.sent).toHaveLength(0);
  });

  it("answered -> no fallback", async () => {
    const { t, api, id } = await startedCall({ MERC_WHATSAPP_CONNECTION: "Merc WA" });
    expect(ok(await outcome(t, { api }, { buddy_call_id: id, outcome: "answered" })).fallback).toBe("none");
    expect((await t.db.buddy_call.require(id)).status).toBe("answered");
  });

  it("another rep cannot report on Nikos' call; unknown id -> not_found", async () => {
    const { t, id } = await startedCall();
    expect(errCode(await outcome(t, {}, { buddy_call_id: id, outcome: "no_answer" }, "eleni"))).toBe("forbidden");
    expect(errCode(await outcome(t, {}, { buddy_call_id: "00000000-0000-4000-8000-000000000000", outcome: "no_answer" }))).toBe("not_found");
  });

  it("lazy timeout: a started call with no report after 3 min -> no_answer + one fallback", async () => {
    const { t, api, id } = await startedCall();
    const db = t.db;
    expect(await timeoutStaleCalls(db, t.platform, { api, now: () => NOW + 60_000 })).toEqual([]);
    expect(await timeoutStaleCalls(db, t.platform, { api, now: () => NOW + 4 * 60_000 })).toEqual([id]);
    expect((await db.buddy_call.require(id)).status).toBe("no_answer");
    expect(await timeoutStaleCalls(db, t.platform, { api, now: () => NOW + 9 * 60_000 })).toEqual([]);
  });
});

describe("merc-buddy trigger tools (OnVoicemailDetected / OnEnd / OnAfterFirstUserMessage)", () => {
  it("call_purpose parsing", () => {
    expect(buddyCallIdFrom({ call_purpose: "merc_buddy:6f6d1a9d-77c7-459e-892a-d5562daae808:callback" })).toBe("6f6d1a9d-77c7-459e-892a-d5562daae808");
    expect(buddyCallIdFrom({ x: "merc_approval:6f6d1a9d-77c7-459e-892a-d5562daae808" })).toBeNull();
  });

  it("voicemail trigger on the outbound session: identity from toNumber, call from the conversation id", async () => {
    const { t, id } = await startedCall();
    const r = await reportFromSession(outboundSession(t), "voicemail", t.key, { now: () => NOW + 20_000 });
    expect(r).toEqual({ buddy_call_id: id, fallback: "app" });
    // OnEnd afterwards is a no-op (already voicemail)
    expect(await reportFromSession(outboundSession(t), "no_answer", t.key)).toMatchObject({ skipped: true });
  });

  it("answered trigger then OnEnd -> stays answered, no fallback", async () => {
    const { t, id } = await startedCall({ MERC_WHATSAPP_CONNECTION: "Merc WA" });
    expect(await reportFromSession(outboundSession(t), "answered", t.key)).toEqual({ buddy_call_id: id, fallback: "none" });
    expect(await reportFromSession(outboundSession(t), "no_answer", t.key)).toMatchObject({ skipped: true });
    expect((await t.db.buddy_call.require(id)).status).toBe("answered");
  });

  it("found by call_purpose when the conversation id differs; inbound sessions and other numbers are skipped", async () => {
    const { t, id } = await startedCall();
    const ctx = outboundSession(t, { id: "other-comm", metadata: { call_purpose: `merc_buddy:${id}:approval_decided` } });
    expect(await reportFromSession(ctx, "no_answer", t.key)).toEqual({ buddy_call_id: id, fallback: "app" });
    const { t: t2 } = await startedCall();
    expect(await reportFromSession(outboundSession(t2, { direction: "inbound", fromNumber: NIKOS_PHONE }), "no_answer", t2.key)).toMatchObject({ skipped: true });
    expect(await reportFromSession(outboundSession(t2, { toNumber: "+306911111111" }), "no_answer", t2.key)).toMatchObject({ skipped: true, reason: "Merc does not know this number" });
  });

  it("model-facing report_buddy_call_outcome injects conversation_id", async () => {
    const { t, id } = await startedCall();
    const r = await reportOutcomeTool(outboundSession(t), { buddy_call_id: id, outcome: "busy" }, t.key, { now: () => NOW });
    expect(r).toEqual({ buddy_call_id: id, fallback: "app" });
  });
});

describe("deploy", () => {
  it("handle entry: internal caller without a user -> forbidden", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx(null, { buddy_call_id: "00000000-0000-4000-8000-000000000000", outcome: "no_answer" })))).toBe("forbidden");
  });
  it("functions/buddy-call-outcome/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "buddy-call-outcome", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("buddy-call-outcome"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
