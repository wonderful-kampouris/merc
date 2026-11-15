// WP-E2E-05 acceptance: the J5 script, twice from a fresh seed, on a fixed clock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AT, IDS, J5_FIX, MAX_BULLETS, MAX_SCRIPT_WORDS, ms, runJ5, type J5Result, type Mode } from "./j5";

const NUOVO = "b28bc378-ec47-55d6-a414-b09ac0dacc3d", FRAPPE = "49df0bbb-3efc-5c7f-98e6-5e8e241addba", HOT_CHOC = "f95e0b6b-9dc7-58e5-8ca3-c1e4ba509909";
const clock = { set: (iso: string) => vi.setSystemTime(new Date(iso)) };
const run = (mode: Mode, briefNotHelpful = true) => runJ5({ mode, clock, briefNotHelpful });

/** The run without generated ids and row timestamps, so two runs from reseed can be compared. */
function normalized(r: J5Result) {
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  const seedIds = new Set<string>([IDS.miltos, IDS.nikos, IDS.org, NUOVO, FRAPPE, HOT_CHOC, "dd6c531d-1412-5df9-8f6e-5df01556c7a8", "e5198444-d143-5b8d-a174-70391f0aa839"]);
  const text = JSON.stringify({ steps: r.steps, sent: r.sent }, (k, v) => (k === "created_at" || k === "updated_at" ? undefined : v));
  return JSON.parse(text.replace(uuid, (m) => (seedIds.has(m) ? m : "<id>")));
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
afterEach(() => { vi.useRealTimers(); });

describe("J5 meeting loop, channels simulated (WhatsApp + calls captured by fakes)", () => {
  it("the scripted run passes twice from reseed with a fixed clock, and both runs are identical", async () => {
    const runs = [await run("simulated"), await run("simulated")];
    for (const r of runs) {
      const s = r.steps as any;
      const { t } = r;
      // REQ-MTG-001: 12:15, one brief on WhatsApp; the cron again at 12:20 sends nothing.
      expect(s.previsit).toMatchObject({ processed: 1, created: 1 });
      expect(s.previsitRerun).toMatchObject({ processed: 0, created: 0 });
      expect(s.brief1).toMatchObject({ status: "sent", channel: "whatsapp", rep_id: IDS.nikos, push_product_id: NUOVO, avoid_product_id: FRAPPE });
      expect(s.brief1Call).toMatchObject({ purpose: "pre_visit", status: "sent", template_name: "merc_previsit_brief" });
      // REQ-MTG-002/003: <= 6 bullets; grinder, his usual 12 kg, push Espresso Nuovo, avoid Frappé Instant; script <= 45 s.
      const bullets = String(s.brief1.bullets_text).split("\n");
      expect(bullets.length).toBeLessThanOrEqual(6);
      expect(s.brief1.bullets_text).toMatch(/[Gg]rinder/);
      expect(s.brief1.bullets_text).toMatch(/12 kg/);
      expect(bullets.find((b) => /Espresso Nuovo/.test(b))).toBeTruthy();
      expect(bullets.find((b) => /Frapp/.test(b))).toBeTruthy();
      expect(String(s.brief1.spoken_script).split(/\s+/).length).toBeLessThanOrEqual(MAX_SCRIPT_WORDS);

      // REQ-MTG-004: "Call me" -> one outbound call to his own number; on the call the buddy reads the same script.
      expect(s.callMe).toMatchObject({ status: "started", channel: "call" });
      expect(s.readBrief.visit_brief_id).toBe(s.brief1.id);
      expect(s.readBrief.spoken_script).toBe(s.brief1.spoken_script);
      expect(s.readBrief.push.product_id).toBe(NUOVO);

      // REQ-MTG-005: nothing at 13:20, one "How did it go at Café Miltos?" at 13:25, nothing at 13:30.
      expect(s.postEarly).toMatchObject({ processed: 0, created: 0 });
      expect(s.post).toMatchObject({ processed: 1, created: 1 });
      expect(s.postRerun).toMatchObject({ processed: 0, created: 0 });
      expect(s.postCall).toMatchObject({ channel: "whatsapp", status: "sent", ref_table: "visit" });

      // The debrief on the call (log_visit): linked to the visit, every internal line applied and undoable.
      expect(s.callBack).toMatchObject({ status: "started", channel: "call" });
      expect(s.debrief.status).toBe("completed");
      const card = s.debrief.result;
      const vl1 = (await t.db.voice_log.get(card.voice_log_id))!;
      expect([vl1.visit_id, vl1.capture_mode, vl1.account_id]).toEqual(["dd6c531d-1412-5df9-8f6e-5df01556c7a8", "live_buddy", IDS.miltos]);
      expect(card.lines.map((l: any) => l.action_type)).toEqual(["create_note", "mark_visit_done", "update_problem", "create_task", "create_draft_order"]);

      // REQ-MTG-006: one WhatsApp summary within 60 s, <= 6 bullets equal to the result card lines (code, no LLM).
      expect(s.confirm.status).toBe("sent");
      expect(s.confirmationRow).toMatchObject({ channel: "whatsapp", status: "sent" });
      expect(ms(s.confirmationRow.sent_at) - ms(vl1.processed_at!)).toBeLessThanOrEqual(60_000);
      const lines = String(s.confirm.summary_text).split("\n");
      expect(lines[0]).toBe("Café Miltos: τι κατέγραψα");
      expect(lines.slice(1)).toEqual(card.lines.map((l: any) => `• ${l.summary}`));
      expect(lines.length - 1).toBeLessThanOrEqual(MAX_BULLETS);
      expect(s.confirmDue).toMatchObject({ created: 0 }); // the cron does not send a second one
      expect(await t.db.debrief_confirmation.all({ rep_id: IDS.nikos })).toHaveLength(1);

      // REQ-MTG-007 "Fix: it was 10 kg, not 12": the 12 kg draft order is undone, a 10 kg one is logged, no second visit,
      // and the correction is stored as feedback with his words.
      expect(s.fixDebrief.status).toBe("completed");
      const fixId = s.fixDebrief.result.voice_log_id;
      expect(await t.db.sales_order.all({ voice_log_id: card.voice_log_id })).toHaveLength(0);
      expect((await t.db.ai_action.all({ voice_log_id: card.voice_log_id })).filter((a) => a.status === "applied")).toHaveLength(0);
      const fixOrders = await t.db.sales_order.all({ voice_log_id: fixId });
      expect(fixOrders).toHaveLength(1);
      expect((await t.db.order_line.all({ order_id: fixOrders[0]!.id })).map((l) => l.quantity)).toEqual([10]);
      expect(await t.db.task.all({ voice_log_id: fixId })).toHaveLength(1);
      expect(await t.db.task.all({ voice_log_id: card.voice_log_id })).toHaveLength(0);
      expect((await t.db.visit.all({ account_id: IDS.miltos, planned_date: "2026-11-16" })).length).toBe(1);
      expect(s.fixFeedback.status).toBe("corrected");
      const dc = (await t.db.debrief_confirmation.get(s.confirmationRow.id))!;
      expect([dc.status, dc.correction_voice_log_id, dc.reply_text]).toEqual(["corrected", fixId, J5_FIX]);

      // REQ-MTG-007/008: one rep_feedback per reply; "Brief did not help" points at the pushed product.
      const fb = await t.db.rep_feedback.all({ rep_id: IDS.nikos });
      expect(fb.map((f) => f.kind).sort()).toEqual(["brief_not_useful", "debrief_corrected"]);
      expect(fb.find((f) => f.kind === "debrief_corrected")).toMatchObject({ detail: J5_FIX, debrief_confirmation_id: dc.id, account_id: IDS.miltos });
      expect(fb.find((f) => f.kind === "brief_not_useful")).toMatchObject({ product_id: NUOVO, visit_brief_id: s.brief1.id, account_id: IDS.miltos });
      expect((await t.db.visit_brief.get(s.brief1.id))!.rating).toBe("not_useful");

      // Acceptance 2: the second Miltos brief pushes a different product (Hot Chocolate), still avoids Frappé.
      expect(s.nextPrevisit).toMatchObject({ processed: 1, created: 1 });
      expect(s.brief2).toMatchObject({ status: "sent", push_product_id: HOT_CHOC, avoid_product_id: FRAPPE });
      expect(s.brief2.push_product_id).not.toBe(s.brief1.push_product_id);
      expect(s.brief2.bullets_text).toMatch(/Hot Chocolate/);
      expect(s.brief2.bullets_text).not.toMatch(/Espresso Nuovo/);

      // Every message and call went to his own number, in this order, and only through the injected fakes.
      expect(r.sent.every((m) => m.to === r.repPhone)).toBe(true);
      expect(r.sent.map((m) => `${m.channel}:${m.template ?? m.purpose?.split(":").pop()}`)).toEqual([
        "whatsapp:merc_previsit_brief", "call:pre_visit", "whatsapp:merc_buddy_ping", "call:post_visit", "whatsapp:merc_debrief_confirm", "whatsapp:merc_previsit_brief",
      ]);
      expect(r.sent[2]!.params).toEqual(["Nikos", "Πώς πήγε στο Café Miltos;"]);
    }
    expect(normalized(runs[1]!)).toEqual(normalized(runs[0]!));
  });

  it("control: without 'Brief did not help' the next Miltos brief still pushes Espresso Nuovo (the change is caused by the feedback)", async () => {
    const r = await run("simulated", false);
    const s = r.steps as any;
    expect(await r.t.db.rep_feedback.all({ kind: "brief_not_useful" })).toHaveLength(0);
    expect(s.brief2).toMatchObject({ push_product_id: NUOVO, avoid_product_id: FRAPPE });
  });
});

describe("J5 meeting loop, channels not live (dev today: no MERC_WHATSAPP_CONNECTION, no service account)", () => {
  it("sends record failed / whatsapp_not_configured without throwing; the rep's taps as buddy tool calls complete the loop", async () => {
    for (let i = 0; i < 2; i++) {
      const r = await run("not_live");
      const s = r.steps as any;
      const { t } = r;
      expect(r.sent).toEqual([]);
      expect(s.previsit).toMatchObject({ processed: 1, created: 0 });
      expect(s.previsit.details.errors).toEqual([]);
      expect(s.brief1).toMatchObject({ status: "failed", push_product_id: NUOVO, avoid_product_id: FRAPPE });
      expect(s.brief1Call).toMatchObject({ status: "failed", failure_reason: "whatsapp_not_configured" });
      expect(s.previsitRerun).toMatchObject({ processed: 0 }); // one attempt per visit, never retried
      // "Call me" cannot dial without a service account: recorded, not thrown; the brief is read in the app instead.
      expect(s.callMe).toMatchObject({ status: "failed", channel: "call" });
      expect((await t.db.buddy_call.get(s.callMe.buddy_call_id))!.failure_reason).toMatch(/^no_service_account/);
      expect(s.readBrief.spoken_script).toBe(s.brief1.spoken_script);
      expect(s.postCall).toMatchObject({ status: "failed", failure_reason: "whatsapp_not_configured" });
      expect(s.postRerun).toMatchObject({ processed: 0 });
      // No WhatsApp: the confirmation goes to the app (REQ-MTG-006/009), no WhatsApp attempt is made for it.
      expect(s.confirmationRow).toMatchObject({ channel: "app", status: "sent" });
      expect(s.confirmationRow.buddy_call_id ?? null).toBeNull();
      expect(s.fixFeedback.status).toBe("corrected");
      expect((await t.db.rep_feedback.all({ rep_id: IDS.nikos })).map((f) => f.kind).sort()).toEqual(["brief_not_useful", "debrief_corrected"]);
      expect(s.brief2).toMatchObject({ status: "failed", push_product_id: HOT_CHOC });
    }
  });
});

describe("fixed clock", () => {
  it("the step times are the SPEC J5 times in Athens (visit 12:45, brief 30 min before, prompt at end + 10 min)", () => {
    const athens = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit" });
    expect([athens(AT.brief), athens(AT.post), athens(AT.nextBrief)]).toEqual(["12:15", "13:25", "12:15"]);
  });
});
