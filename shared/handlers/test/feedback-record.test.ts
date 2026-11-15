import { describe, expect, it } from "vitest";
import { defineFunction, runAsTool, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { handle, impl } from "../src/feedback-record";
import { makeImpl as briefImpl } from "../src/visit-brief-get";
import { completedLog, expectFreshBundle, miltosVisit, noLlmBrief, type Kit } from "./meeting-loop-fixtures";

const briefFor = async (t: Kit, now: number, regenerate = false) => {
  const v = await miltosVisit(t);
  return ok(await defineFunction("visit-brief-get", briefImpl(noLlmBrief(now)) as any, { checkResponse: false })(t.fnCtx("nikos", { visit_id: v.id, ...(regenerate ? { regenerate: true } : {}) })));
};
const nowFor = async (t: Kit) => Date.parse((await miltosVisit(t)).planned_start_at!) - 20 * 60_000;

describe("fn:feedback-record (REQ-MTG-007/008)", () => {
  it("'Not useful' on a brief rates it, stores the push product, and the next brief at Miltos pushes a different product", async () => {
    const t = kit();
    const now = await nowFor(t);
    const brief = await briefFor(t, now);
    expect(brief.push).toBeTruthy();
    const r = ok(await handle(t.fnCtx("nikos", { kind: "brief_not_useful", visit_brief_id: brief.visit_brief_id, detail: "He already said no to Nuovo" })));
    expect(validateResponse("feedback-record", r).ok).toBe(true);
    expect(r.status).toBe("not_useful");
    expect((await t.db.visit_brief.require(brief.visit_brief_id)).rating).toBe("not_useful");
    const fb = await t.db.rep_feedback.require(r.feedback_id);
    expect(fb).toMatchObject({ kind: "brief_not_useful", account_id: IDS.miltos, product_id: brief.push.product_id, exported_to_evals: false });
    const next = await briefFor(t, now, true);
    expect(next.push?.product_id).not.toBe(brief.push.product_id);
  });

  it("'Brief did not help' on a debrief confirmation finds the visit's brief", async () => {
    const t = kit();
    const now = await nowFor(t);
    const brief = await briefFor(t, now);
    const { vl, visit } = await completedLog(t, now + 60 * 60_000);
    const dc = await t.db.debrief_confirmation.insert({ voice_log_id: vl.id, rep_id: IDS.nikos, visit_id: visit.id, channel: "app", summary_text: "x", status: "sent" } as any);
    const r = ok(await handle(t.fnCtx("nikos", { kind: "brief_not_useful", debrief_confirmation_id: dc.id })));
    expect((await t.db.rep_feedback.require(r.feedback_id)).visit_brief_id).toBe(brief.visit_brief_id);
  });

  it("Correct confirms; Fix needs the rep's words and stores them verbatim", async () => {
    const t = kit();
    const { vl, visit } = await completedLog(t, Date.parse("2026-11-16T10:00:00Z"));
    const dc = await t.db.debrief_confirmation.insert({ voice_log_id: vl.id, rep_id: IDS.nikos, visit_id: visit.id, channel: "whatsapp", summary_text: "x", status: "sent" } as any);
    expect(errCode(await handle(t.fnCtx("nikos", { kind: "debrief_corrected", debrief_confirmation_id: dc.id })))).toBe("validation_failed");
    const words = "Ήταν 10 κιλά, όχι 12";
    const fixed = ok(await handle(t.fnCtx("nikos", { kind: "debrief_corrected", debrief_confirmation_id: dc.id, detail: words })));
    expect(fixed.status).toBe("corrected");
    expect(await t.db.debrief_confirmation.require(dc.id)).toMatchObject({ status: "corrected", reply_text: words });
    expect((await t.db.rep_feedback.require(fixed.feedback_id))).toMatchObject({ kind: "debrief_corrected", detail: words, account_id: IDS.miltos });
    const ok2 = ok(await handle(t.fnCtx("nikos", { kind: "debrief_confirmed", debrief_confirmation_id: dc.id })));
    expect(ok2.status).toBe("confirmed");
  });

  it("another rep cannot rate Nikos's brief; a spoofed caller is ignored", async () => {
    const t = kit();
    const brief = await briefFor(t, await nowFor(t));
    expect(errCode(await handle(t.fnCtx("dimitra", { kind: "brief_useful", visit_brief_id: brief.visit_brief_id })))).toBe("forbidden");
    ok(await handle(t.fnCtx("nikos", { kind: "brief_useful", visit_brief_id: brief.visit_brief_id, caller: IDS.dimitra })));
  });

  it("the buddy tool record_feedback gives the same status as the function", async () => {
    const t = kit();
    const brief = await briefFor(t, await nowFor(t));
    const viaTool: any = await runAsTool("feedback-record", impl, t.toolCtx("nikos"), { kind: "brief_useful", visit_brief_id: brief.visit_brief_id }, t.key);
    expect(viaTool.status).toBe("useful");
  });

  it("functions/feedback-record/handler.gen.js is the current bundle", async () => { await expectFreshBundle("feedback-record"); });
});
