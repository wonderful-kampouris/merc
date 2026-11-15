import { describe, expect, it } from "vitest";
import { defineFunction, runAsTool, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { handle, impl, makeImpl, summaryBullets, MAX_BULLETS } from "../src/debrief-confirm-send";
import { LIVE, NIKOS_PHONE, WA, completedLog, expectFreshBundle, fakeOutbound } from "./meeting-loop-fixtures";

const NOW = Date.parse("2026-11-16T10:20:00Z");
const fn = (deps: any) => defineFunction("debrief-confirm-send", makeImpl(deps) as any);

describe("fn:debrief-confirm-send (REQ-MTG-006)", () => {
  it("WhatsApp live: one summary built from the result card, template merc_debrief_confirm; a second call reuses it", async () => {
    const t = kit({ globals: LIVE });
    const { vl } = await completedLog(t, NOW - 30_000);
    const outbound = fakeOutbound();
    const r = ok(await fn({ outbound, now: () => NOW })(t.fnCtx("nikos", { voice_log_id: vl.id })));
    expect(validateResponse("debrief-confirm-send", r).ok).toBe(true);
    expect(r.status).toBe("sent");
    expect(r.summary_text).toMatch(/^Café Miltos/);
    expect(r.summary_text).toMatch(/bring samples on Thursday/);
    expect(r.summary_text).toMatch(/technician on Friday/);
    expect(outbound.sent).toHaveLength(1);
    expect(outbound.sent[0]).toMatchObject({ kind: "template", templateName: "merc_debrief_confirm", destination: NIKOS_PHONE });
    const row = await t.db.debrief_confirmation.require(r.debrief_confirmation_id);
    expect(row).toMatchObject({ channel: "whatsapp", status: "sent", voice_log_id: vl.id });
    const again = ok(await fn({ outbound, now: () => NOW })(t.fnCtx("nikos", { voice_log_id: vl.id })));
    expect(again.debrief_confirmation_id).toBe(r.debrief_confirmation_id);
    expect(outbound.sent).toHaveLength(1);
  });

  it("no WhatsApp connection: the confirmation goes to the app", async () => {
    const t = kit({ globals: {} });
    const { vl } = await completedLog(t, NOW);
    const outbound = fakeOutbound();
    const r = ok(await fn({ outbound, now: () => NOW })(t.fnCtx("nikos", { voice_log_id: vl.id })));
    expect((await t.db.debrief_confirmation.require(r.debrief_confirmation_id))).toMatchObject({ channel: "app", status: "sent" });
    expect(outbound.sent).toHaveLength(0);
  });

  it("WhatsApp configured but channels not live: falls back to the app and keeps the reason on the buddy_call", async () => {
    const t = kit({ globals: WA });
    const { vl } = await completedLog(t, NOW);
    const r = ok(await fn({ outbound: fakeOutbound(), now: () => NOW })(t.fnCtx("nikos", { voice_log_id: vl.id })));
    const row = await t.db.debrief_confirmation.require(r.debrief_confirmation_id);
    expect(row).toMatchObject({ channel: "app", status: "sent" });
    expect((await t.db.buddy_call.require(row.buddy_call_id!)).failure_reason).toMatch(/channels_not_live/);
  });

  it("another rep is forbidden; a spoofed caller in the body is ignored", async () => {
    const t = kit({ globals: {} });
    const { vl } = await completedLog(t, NOW);
    expect(errCode(await handle(t.fnCtx("dimitra", { voice_log_id: vl.id }) as any))).toBe("forbidden");
    ok(await handle(t.fnCtx("nikos", { voice_log_id: vl.id, caller: IDS.dimitra }) as any));
  });

  it("a voice log that is not completed cannot be confirmed", async () => {
    const t = kit({ globals: {} });
    const { vl } = await completedLog(t, NOW);
    await t.db.voice_log.update(vl.id, { status: "processing" });
    expect(errCode(await handle(t.fnCtx("nikos", { voice_log_id: vl.id }) as any))).toBe("validation_failed");
  });

  it("at most 6 bullets; the overflow is counted in code", () => {
    const lines = Array.from({ length: 8 }, (_, i) => ({ status: "applied", summary: `Action ${i + 1}` })) as any;
    const b = summaryBullets({ lines, pending_approvals: [] } as any, "en");
    expect(b).toHaveLength(MAX_BULLETS);
    expect(b.at(-1)).toBe("• +3 more in the app");
  });

  it("the buddy tool send_debrief_confirmation gives the same result as the function", async () => {
    const t = kit({ globals: {} });
    const { vl } = await completedLog(t, NOW);
    const viaTool: any = await runAsTool("debrief-confirm-send", impl, t.toolCtx("nikos"), { voice_log_id: vl.id }, t.key);
    expect(viaTool.status).toBe("sent");
    const viaFn = ok(await handle(t.fnCtx("nikos", { voice_log_id: vl.id }) as any));
    expect(viaFn.debrief_confirmation_id).toBe(viaTool.debrief_confirmation_id);
  });

  it("functions/debrief-confirm-send/handler.gen.js is the current bundle", async () => { await expectFreshBundle("debrief-confirm-send"); });
});
