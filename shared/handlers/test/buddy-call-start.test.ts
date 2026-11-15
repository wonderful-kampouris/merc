import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { callerFromTool, defineFunction, runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import {
  CALL_PURPOSE_PREFIX, OUTBOUND_PATH, QUICK_REPLIES, TEMPLATES, WA_RELAY_HEADER, callMeBackTool, deliverRelayedWhatsApp, handle, makeImpl, nextCallSlot, type BuddyDeps,
} from "../src/buddy-call-start";
import { kit, ok, errCode, IDS, type Kit } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

// 2026-11-16 10:00Z = 12:00 Athens (inside 07:30-21:00).
const NOW = Date.parse("2026-11-16T10:00:00Z");
const NIKOS_PHONE = "+306900000003";
const BUDDY_NUMBER = "+18455133803";
const LIVE = { MERC_BUDDY_NUMBER: BUDDY_NUMBER, MERC_CHANNELS_LIVE: true, MERC_WHATSAPP_CONNECTION: "Merc WA" };

const fakeApi = () => { const calls: Array<{ path: string; body: any }> = []; return { calls, post: async (path: string, o?: { body?: unknown }) => { calls.push({ path, body: o?.body }); return path === OUTBOUND_PATH ? { id: "comm-out-1" } : {}; } }; };
const fakeOutbound = () => {
  const sent: Array<{ kind: string; o: any }> = [];
  return { sent, whatsapp: { sendTemplate: (o: any) => { sent.push({ kind: "template", o }); return "rendered"; }, sendInteractive: (o: any) => { sent.push({ kind: "interactive", o }); return "ok"; } } };
};
const run = (t: Kit, deps: BuddyDeps, body: unknown, who: "nikos" | "eleni" = "nikos") => defineFunction("buddy-call-start", makeImpl({ now: () => NOW, ...deps }) as any)(t.fnCtx(who, body));
const voiceLog = (t: Kit) => t.db.voice_log.insert({ rep_id: IDS.nikos, capture_mode: "typed", status: "completed", idempotency_key: `vl-${Math.random()}`, recorded_at: new Date(NOW).toISOString() } as any);
const pushes = (api: ReturnType<typeof fakeApi>) => api.calls.filter((c) => c.path !== OUTBOUND_PATH);

/** A phone/WhatsApp tool session as the platform builds it: no signed claim, only the channel numbers. */
const channelCtx = (t: Kit, comm: Record<string, unknown>) => ({ tables: t.tables, secrets: t.platform.secrets, globals: t.platform.globals, metadata: { communication: { id: "comm-ch-1", metadata: {}, ...comm } } }) as any;

describe("fn:buddy-call-start (REQ-BUD-014)", () => {
  it("'call me at 5' -> scheduled for 17:00 Athens; request and response match the contract", async () => {
    const t = kit({ globals: LIVE });
    const api = fakeApi();
    const body = { purpose: "callback", reason: "Call me at 5", at: "2026-11-16T15:00:00Z", channel: "call" };
    expect(validateRequest("buddy-call-start", body).ok).toBe(true);
    const out = ok(await run(t, { api }, body));
    expect(validateResponse("buddy-call-start", out).ok).toBe(true);
    expect(out).toMatchObject({ status: "scheduled", channel: "call", due_at: "2026-11-16T15:00:00.000Z" });
    expect(api.calls.filter((c) => c.path === OUTBOUND_PATH)).toHaveLength(0);
    expect(await t.db.buddy_call.require(out.buddy_call_id)).toMatchObject({ user_id: IDS.nikos, status: "scheduled", purpose: "callback" });
  });

  it("now + MERC_CHANNELS_LIVE false -> no call placed; failed/channels_not_live with the exact request body", async () => {
    const t = kit({ globals: { MERC_BUDDY_NUMBER: BUDDY_NUMBER, MERC_CHANNELS_LIVE: false } });
    const api = fakeApi();
    const logs: any[] = [];
    const out = ok(await run(t, { api, log: (_l, m, d) => logs.push({ m, d }) }, { purpose: "callback" }));
    expect(out.status).toBe("failed");
    expect(api.calls.filter((c) => c.path === OUTBOUND_PATH)).toHaveLength(0);
    const row = await t.db.buddy_call.require(out.buddy_call_id);
    expect(row.failure_reason).toMatch(/^channels_not_live: would POST \/v1\/agents\/outbound /);
    const would = logs.find((l) => l.d?.would_post)!.d.would_post;
    expect(would.body).toEqual({ from: BUDDY_NUMBER, to: NIKOS_PHONE, call_purpose: `${CALL_PURPOSE_PREFIX}${row.id}:callback`, answer_timeout_after_progress_seconds: 25 });
  });

  it("now + live -> ONE outbound call from MERC_BUDDY_NUMBER to the caller's own phone; conversation id stored", async () => {
    const t = kit({ globals: LIVE });
    const api = fakeApi();
    const out = ok(await run(t, { api }, { purpose: "approval_decided", reason: "Eleni approved 8% for Fournos Kostas", ref_table: "approval", ref_id: "a-1" }));
    expect(out).toMatchObject({ status: "started", channel: "call" });
    const dials = api.calls.filter((c) => c.path === OUTBOUND_PATH);
    expect(dials).toHaveLength(1);
    expect(dials[0].body).toMatchObject({ from: BUDDY_NUMBER, to: NIKOS_PHONE });
    expect(await t.db.buddy_call.require(out.buddy_call_id)).toMatchObject({ status: "started", wonderful_conversation_id: "comm-out-1" });
    expect(pushes(api).some((c) => c.body?.data?.type === "buddy_call.status")).toBe(true);
  });

  it("target is never a request field: a spoofed number or caller is rejected / ignored", async () => {
    const t = kit({ globals: LIVE });
    const api = fakeApi();
    expect(errCode(await run(t, { api }, { purpose: "callback", to: "+306999999999" }))).toBe("validation_failed");
    const out = ok(await run(t, { api }, { purpose: "callback", caller: { user_id: IDS.eleni } }));
    expect((await t.db.buddy_call.require(out.buddy_call_id)).user_id).toBe(IDS.nikos);
    expect(api.calls.find((c) => c.path === OUTBOUND_PATH)!.body.to).toBe(NIKOS_PHONE);
  });

  it("call hours 07:30-21:00 org time: 22:30 Athens -> scheduled at 07:30 next day; 06:00 -> 07:30 same day", async () => {
    const org = { timezone: "Europe/Athens" };
    expect(new Date(nextCallSlot(org, Date.parse("2026-11-16T20:30:00Z"))).toISOString()).toBe("2026-11-17T05:30:00.000Z");
    expect(new Date(nextCallSlot(org, Date.parse("2026-11-16T04:00:00Z"))).toISOString()).toBe("2026-11-16T05:30:00.000Z");
    const t = kit({ globals: LIVE });
    const api = fakeApi();
    const out = ok(await defineFunction("buddy-call-start", makeImpl({ api, now: () => Date.parse("2026-11-16T20:30:00Z") }) as any)(t.fnCtx("nikos", { purpose: "eod" })));
    expect(out).toMatchObject({ status: "scheduled", due_at: "2026-11-17T05:30:00.000Z" });
    expect(api.calls.filter((c) => c.path === OUTBOUND_PATH)).toHaveLength(0);
  });

  it("idempotent on (user, purpose, ref_id) for 10 min; a pending callback is moved, not duplicated", async () => {
    const t = kit({ globals: LIVE });
    const api = fakeApi();
    const a = ok(await run(t, { api }, { purpose: "approval_decided", ref_table: "approval", ref_id: "a-2" }));
    const b = ok(await run(t, { api }, { purpose: "approval_decided", ref_table: "approval", ref_id: "a-2" }));
    expect(b.buddy_call_id).toBe(a.buddy_call_id);
    expect(api.calls.filter((c) => c.path === OUTBOUND_PATH)).toHaveLength(1);
    const s1 = ok(await run(t, { api }, { purpose: "callback", at: "2026-11-16T15:00:00Z" }));
    const s2 = ok(await run(t, { api }, { purpose: "callback", at: "2026-11-16T16:00:00Z" }));
    expect(s2.buddy_call_id).toBe(s1.buddy_call_id);
    expect(s2.due_at).toBe("2026-11-16T16:00:00.000Z");
  });

  it("rep without a phone or with phone_channel_enabled=false -> failed with the reason, nothing dialled", async () => {
    const t = kit({ globals: LIVE });
    const api = fakeApi();
    await t.db.app_user.update(IDS.nikos, { phone_channel_enabled: false });
    const out = ok(await run(t, { api }, { purpose: "callback" }));
    expect(out.status).toBe("failed");
    expect((await t.db.buddy_call.require(out.buddy_call_id)).failure_reason).toBe("phone_channel_disabled");
    expect(api.calls.filter((c) => c.path === OUTBOUND_PATH)).toHaveLength(0);
  });

  it("channel defaults to notify_channel (app -> call)", async () => {
    const t = kit({ globals: LIVE });
    expect(ok(await run(t, { api: fakeApi() }, { purpose: "callback", at: "2026-11-16T15:00:00Z" })).channel).toBe("call");
    await t.db.app_user.update(IDS.nikos, { notify_channel: "whatsapp" });
    expect(ok(await run(t, { api: fakeApi() }, { purpose: "alert", at: "2026-11-16T15:00:00Z" })).channel).toBe("whatsapp");
  });

  it("'call me' (purpose callback, no channel) rings the phone even when notify_channel is whatsapp", async () => {
    const t = kit({ globals: LIVE });
    await t.db.app_user.update(IDS.nikos, { notify_channel: "whatsapp" });
    expect(ok(await run(t, { api: fakeApi() }, { purpose: "callback" })).channel).toBe("call");
  });
});

describe("WhatsApp (REQ-BUD-015, REQ-MTG-001/005/006)", () => {
  it("MERC_WHATSAPP_CONNECTION missing -> status failed / whatsapp_not_configured, no throw, nothing sent", async () => {
    const t = kit({ globals: { MERC_CHANNELS_LIVE: true } });
    const outbound = fakeOutbound();
    const out = ok(await run(t, { outbound }, { purpose: "callback", channel: "whatsapp" }));
    expect(out).toMatchObject({ status: "failed", channel: "whatsapp" });
    expect((await t.db.buddy_call.require(out.buddy_call_id)).failure_reason).toBe("whatsapp_not_configured");
    expect(outbound.sent).toHaveLength(0);
  });

  it("connection set but MERC_CHANNELS_LIVE false -> nothing sent (channels_not_live)", async () => {
    const t = kit({ globals: { MERC_WHATSAPP_CONNECTION: "Merc WA", MERC_CHANNELS_LIVE: false } });
    const outbound = fakeOutbound();
    const out = ok(await run(t, { outbound }, { purpose: "callback", channel: "whatsapp" }));
    expect((await t.db.buddy_call.require(out.buddy_call_id)).failure_reason).toBe("channels_not_live");
    expect(outbound.sent).toHaveLength(0);
  });

  it("pre_visit outside the window -> template merc_previsit_brief with the brief bullets to the rep's own number", async () => {
    const t = kit({ globals: LIVE });
    const outbound = fakeOutbound();
    const visit = (await t.db.visit.all({ rep_id: IDS.nikos }))[0]!;
    const brief = await t.db.visit_brief.insert({ visit_id: visit.id, rep_id: IDS.nikos, account_id: visit.account_id, bullets_text: "• Push the new espresso\n• Ask about the summer menu", spoken_script: "Quick brief.", channel: "whatsapp", status: "generated", generated_at: new Date(NOW).toISOString() } as any);
    const out = ok(await run(t, { outbound }, { purpose: "pre_visit", channel: "whatsapp", ref_table: "visit_brief", ref_id: brief.id }));
    expect(out.status).toBe("sent");
    expect(outbound.sent).toHaveLength(1);
    expect(outbound.sent[0]).toMatchObject({ kind: "template", o: { destination: NIKOS_PHONE, templateName: TEMPLATES.pre_visit, languageCode: "el", connectionName: "Merc WA" } });
    expect(outbound.sent[0].o.templateParams[2]).toContain("Push the new espresso");
    expect((await t.db.buddy_call.require(out.buddy_call_id)).template_name).toBe("merc_previsit_brief");
  });

  it("inside whatsapp_window_until -> interactive free-form with the quick replies (pre_visit, debrief_confirm)", async () => {
    const t = kit({ globals: LIVE });
    await t.db.app_user.update(IDS.nikos, { whatsapp_window_until: new Date(NOW + 3_600_000).toISOString() });
    const outbound = fakeOutbound();
    const visit = (await t.db.visit.all({ rep_id: IDS.nikos }))[0]!;
    const brief = await t.db.visit_brief.insert({ visit_id: visit.id, rep_id: IDS.nikos, account_id: visit.account_id, bullets_text: "• one", channel: "whatsapp", status: "generated", generated_at: new Date(NOW).toISOString() } as any);
    ok(await run(t, { outbound }, { purpose: "pre_visit", channel: "whatsapp", ref_table: "visit_brief", ref_id: brief.id }));
    expect(outbound.sent[0]!.kind).toBe("interactive");
    expect(outbound.sent[0]!.o.interaction.buttons.map((b: any) => b.title)).toEqual(["Call me", "Useful", "Not useful"]);
    const vl = await voiceLog(t);
    const dc = await t.db.debrief_confirmation.insert({ voice_log_id: vl?.id, rep_id: IDS.nikos, visit_id: visit.id, channel: "whatsapp", summary_text: "• Ordered 20 kg espresso", status: "pending" } as any);
    ok(await run(t, { outbound }, { purpose: "debrief_confirm", channel: "whatsapp", ref_table: "debrief_confirmation", ref_id: dc.id }));
    expect(outbound.sent[1]!.o.interaction.buttons.map((b: any) => b.title)).toEqual(QUICK_REPLIES.debrief_confirm.map((b) => b.title));
    expect(outbound.sent[1]!.o.message).toContain("Ordered 20 kg espresso");
  });

  it("debrief_confirm template and post_visit 'How did it go at <account>?'", async () => {
    const t = kit({ globals: LIVE });
    await t.db.app_user.update(IDS.nikos, { preferred_language: "en" });
    const outbound = fakeOutbound();
    const visit = (await t.db.visit.all({ rep_id: IDS.nikos }))[0]!;
    const acct = await t.db.account.require(visit.account_id);
    ok(await run(t, { outbound }, { purpose: "post_visit", channel: "whatsapp", ref_table: "visit", ref_id: visit.id }));
    expect(outbound.sent[0]!.o).toMatchObject({ templateName: TEMPLATES.ping, languageCode: "en_US" });
    expect(outbound.sent[0]!.o.templateParams[1]).toBe(`How did it go at ${acct.name}?`);
    const dc = await t.db.debrief_confirmation.insert({ rep_id: IDS.nikos, visit_id: visit.id, channel: "whatsapp", summary_text: "• one\n• two", status: "pending", voice_log_id: (await voiceLog(t)).id } as any);
    ok(await run(t, { outbound }, { purpose: "debrief_confirm", channel: "whatsapp", ref_table: "debrief_confirmation", ref_id: dc.id }));
    expect(outbound.sent[1]!.o).toMatchObject({ templateName: TEMPLATES.debrief_confirm, templateParams: ["Nikos", "• one\n• two"] });
  });

  it("another rep's visit_brief is not leaked: falls back to the generic ping", async () => {
    const t = kit({ globals: LIVE });
    const outbound = fakeOutbound();
    const visit = (await t.db.visit.all({ rep_id: IDS.dimitra }))[0] ?? (await t.db.visit.all({ rep_id: IDS.nikos }))[0]!;
    const brief = await t.db.visit_brief.insert({ visit_id: visit.id, rep_id: IDS.dimitra, account_id: visit.account_id, bullets_text: "SECRET", channel: "whatsapp", status: "generated", generated_at: new Date(NOW).toISOString() } as any);
    ok(await run(t, { outbound }, { purpose: "pre_visit", channel: "whatsapp", ref_table: "visit_brief", ref_id: brief.id }));
    expect(outbound.sent[0]!.o.templateName).toBe(TEMPLATES.ping);
    expect(JSON.stringify(outbound.sent[0]!.o)).not.toContain("SECRET");
  });
});

describe("channel-number identity (REQ-BUD-013, shared/core me.ts unchanged)", () => {
  const params = { purpose: "callback", at: "2026-11-16T15:00:00Z" };

  it("inbound phone: communication.fromNumber -> the matching rep", async () => {
    const t = kit({ globals: LIVE });
    const ctx = channelCtx(t, { type: "voice", direction: "inbound", fromNumber: "+30 690 000 0003", toNumber: BUDDY_NUMBER });
    expect(callerFromTool(ctx, t.key)).toEqual({ kind: "channel_number", number: NIKOS_PHONE, channel: "phone" });
    const out = ok(await callMeBackTool(ctx, params, t.key, { now: () => NOW }));
    expect((await t.db.buddy_call.require(out.buddy_call_id)).user_id).toBe(IDS.nikos);
  });

  it("outbound phone: communication.toNumber is the rep (fromNumber is the Merc number)", async () => {
    const t = kit({ globals: LIVE });
    const ctx = channelCtx(t, { type: "phone_call", direction: "outbound", fromNumber: BUDDY_NUMBER, toNumber: NIKOS_PHONE });
    const out = ok(await callMeBackTool(ctx, params, t.key, { now: () => NOW }));
    expect((await t.db.buddy_call.require(out.buddy_call_id)).user_id).toBe(IDS.nikos);
  });

  it("WhatsApp: fromNumber (whatsapp: prefix) -> the rep; the tool runtime's context.outbound sends", async () => {
    const t = kit({ globals: LIVE });
    const outbound = fakeOutbound();
    const ctx = { ...channelCtx(t, { type: "whatsapp", direction: "inbound", fromNumber: "whatsapp:+306900000003" }), outbound };
    expect(callerFromTool(ctx, t.key)).toMatchObject({ channel: "whatsapp", number: NIKOS_PHONE });
    const out = ok(await callMeBackTool(ctx, { purpose: "callback", channel: "whatsapp" }, t.key, { now: () => NOW }));
    expect(out.status).toBe("sent");
    expect(outbound.sent[0]!.o.destination).toBe(NIKOS_PHONE);
  });

  it("unknown number -> forbidden 'Merc does not know this number', nothing written", async () => {
    const t = kit({ globals: LIVE });
    const before = (await t.db.buddy_call.all({})).length;
    const r = await callMeBackTool(channelCtx(t, { type: "voice", direction: "inbound", fromNumber: "+306911111111" }), params, t.key);
    expect(r).toMatchObject({ error: { code: "forbidden", message: "Merc does not know this number" } });
    expect((await t.db.buddy_call.all({})).length).toBe(before);
  });

  it("a number shared by two active users -> forbidden; phone_channel_enabled=false -> unknown", async () => {
    const t = kit({ globals: LIVE });
    await t.db.app_user.update(IDS.dimitra, { phone: NIKOS_PHONE });
    const ctx = channelCtx(t, { type: "voice", direction: "inbound", fromNumber: NIKOS_PHONE });
    expect(await callMeBackTool(ctx, params, t.key)).toMatchObject({ error: { code: "forbidden", message: "phone number matches more than one Merc user" } });
    await t.db.app_user.update(IDS.dimitra, { phone_channel_enabled: false });
    ok(await callMeBackTool(ctx, params, t.key, { now: () => NOW }));
    await t.db.app_user.update(IDS.nikos, { phone_channel_enabled: false });
    expect(errCode(await callMeBackTool(ctx, params, t.key))).toBe("forbidden");
  });

  it("what the caller says is never identity: a spoofed caller param on a phone session is ignored", async () => {
    const t = kit({ globals: LIVE });
    const ctx = channelCtx(t, { type: "voice", direction: "inbound", fromNumber: NIKOS_PHONE });
    const out = ok(await callMeBackTool(ctx, { ...params, caller: { user_id: IDS.thanasis } }, t.key, { now: () => NOW }));
    expect((await t.db.buddy_call.require(out.buddy_call_id)).user_id).toBe(IDS.nikos);
  });

  it("browser session: the signed claim path still works through the same tool entry", async () => {
    const t = kit({ globals: LIVE });
    const out = ok(await callMeBackTool(t.toolCtx("nikos"), params, t.key, { now: () => NOW }));
    expect(out.status).toBe("scheduled");
    expect(ok(await runAsTool("buddy-call-start", makeImpl({ now: () => NOW }) as any, t.toolCtx("dimitra"), params, t.key)).status).toBe("scheduled");
  });
});

describe("deploy", () => {
  it("handle (deployed entry) runs with the platform context; no user -> forbidden", async () => {
    const t = kit({ globals: { MERC_BUDDY_NUMBER: BUDDY_NUMBER, MERC_CHANNELS_LIVE: false } });
    expect(errCode(await handle(t.fnCtx(null, { purpose: "callback" })))).toBe("forbidden");
    const r = ok(await handle(t.fnCtx("nikos", { purpose: "callback", at: "2099-01-01T10:00:00Z" })));
    expect(r.status).toBe("scheduled");
  });

  it("functions/buddy-call-start/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "buddy-call-start", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("buddy-call-start"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});

describe("WhatsApp relay through merc-ops (Functions have no context.outbound)", () => {
  const RELAY = { ...LIVE, MERC_OPS_WHATSAPP_URL: "https://hooks.test/wa" };
  const fakeFetch = () => { const posts: Array<{ url: string; headers: Record<string, string>; body: any }> = []; return { posts, fetch: async (url: string, init: any) => { posts.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; } }; };

  it("no outbound + relay wired -> POSTs only the buddy_call id to the hook, row started, nothing sent yet", async () => {
    const t = kit({ globals: RELAY, secrets: { MERC_OPS_WHATSAPP_HOOK: "wa-key" } });
    const f = fakeFetch();
    const out = ok(await run(t, { fetch: f.fetch }, { purpose: "callback", channel: "whatsapp" }));
    const row = await t.db.buddy_call.require(out.buddy_call_id);
    expect(row.status).toBe("started");
    expect(f.posts).toHaveLength(1);
    expect(f.posts[0]!.url).toBe("https://hooks.test/wa");
    expect(f.posts[0]!.headers[WA_RELAY_HEADER]).toBe("wa-key");
    expect(f.posts[0]!.body).toMatchObject({ task_type: "whatsapp_send", buddy_call_id: row.id });
  });

  it("deliver_whatsapp with outbound sends the relayed row once; a second delivery is skipped", async () => {
    const t = kit({ globals: RELAY, secrets: { MERC_OPS_WHATSAPP_HOOK: "wa-key" } });
    const out = ok(await run(t, { fetch: fakeFetch().fetch }, { purpose: "callback", channel: "whatsapp" }));
    const outbound = fakeOutbound();
    const first = await deliverRelayedWhatsApp(t.tables as any, t.platform as any, { outbound, now: () => NOW }, out.buddy_call_id);
    expect(first.status).toBe("sent");
    expect(outbound.sent).toHaveLength(1);
    expect(outbound.sent[0]!.o.destination).toBe(NIKOS_PHONE);
    const again = await deliverRelayedWhatsApp(t.tables as any, t.platform as any, { outbound, now: () => NOW }, out.buddy_call_id);
    expect(again.skipped).toBeTruthy();
    expect(outbound.sent).toHaveLength(1);
  });

  it("no outbound and no relay wired -> failed with the reason, no throw", async () => {
    const t = kit({ globals: LIVE });
    const out = ok(await run(t, { fetch: fakeFetch().fetch }, { purpose: "callback", channel: "whatsapp" }));
    const row = await t.db.buddy_call.require(out.buddy_call_id);
    expect(row.status).toBe("failed");
    expect(row.failure_reason).toMatch(/relay not wired/);
  });
});

describe("WhatsApp default connection", () => {
  it("MERC_WHATSAPP_CONNECTION=default sends without connectionName", async () => {
    const t = kit({ globals: { MERC_WHATSAPP_CONNECTION: "default", MERC_CHANNELS_LIVE: true } });
    const outbound = fakeOutbound();
    const out = ok(await run(t, { outbound }, { purpose: "callback", channel: "whatsapp" }));
    expect(out.status).toBe("sent");
    expect(outbound.sent).toHaveLength(1);
    expect(JSON.stringify(outbound.sent[0])).not.toContain("connectionName");
  });
});
