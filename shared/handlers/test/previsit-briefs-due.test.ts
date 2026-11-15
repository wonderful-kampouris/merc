import { describe, expect, it } from "vitest";
import { runAsSystem, validateResponse } from "../../core/src/index";
import { kit, ok, IDS } from "../src/_lib/testkit";
import { makeImpl, type PrevisitDeps } from "../src/previsit-briefs-due";
import { OUTBOUND_PATH } from "../src/buddy-call-start";
import { LIVE, NIKOS_PHONE, WA, expectFreshBundle, fakeApi, fakeOutbound, miltosVisit, noLlmBrief, type Kit } from "./meeting-loop-fixtures";

const cron = (t: Kit, d: PrevisitDeps, data: unknown = {}) =>
  runAsSystem("previsit-briefs-due", makeImpl(d), { tables: t.tables, data, orgId: IDS.org, platform: t.platform });
const at = async (t: Kit, minutesBefore: number) => Date.parse((await miltosVisit(t)).planned_start_at!) - minutesBefore * 60_000;

describe("fn:previsit-briefs-due (REQ-MTG-001)", () => {
  it("20 min before Café Miltos: one brief, one WhatsApp template to Nikos's own number; a re-run sends nothing", async () => {
    const t = kit({ globals: LIVE });
    const now = await at(t, 20);
    const outbound = fakeOutbound();
    const d = { buddy: { outbound, now: () => now }, brief: noLlmBrief(now) };
    const r = ok(await cron(t, d));
    expect(validateResponse("previsit-briefs-due", r).ok).toBe(true);
    expect(r).toMatchObject({ processed: 1, created: 1 });
    const v = await miltosVisit(t);
    const brief = await t.db.visit_brief.findOne({ visit_id: v.id });
    expect(brief).toMatchObject({ status: "sent", channel: "whatsapp", rep_id: IDS.nikos });
    const nuovo = await t.db.product.findOne({ sku: "ESP-NEW-1" });
    expect(brief!.push_product_id).toBe(nuovo!.id); // REQ-MTG-003: chosen in code
    expect(outbound.sent).toHaveLength(1);
    expect(outbound.sent[0]).toMatchObject({ kind: "template", templateName: "merc_previsit_brief", destination: NIKOS_PHONE });
    const call = await t.db.buddy_call.require(brief!.buddy_call_id!);
    expect(call).toMatchObject({ purpose: "pre_visit", ref_table: "visit_brief", ref_id: brief!.id, status: "sent" });

    expect(ok(await cron(t, d))).toMatchObject({ processed: 0, created: 0 });
    expect(outbound.sent).toHaveLength(1);
  });

  it("a visit two hours away is not briefed yet", async () => {
    const t = kit({ globals: LIVE });
    const now = await at(t, 120);
    const r = ok(await cron(t, { buddy: { outbound: fakeOutbound(), now: () => now }, brief: noLlmBrief(now) }));
    expect(r).toMatchObject({ processed: 0, created: 0 });
    expect(await t.db.visit_brief.findOne({ visit_id: (await miltosVisit(t)).id })).toBeNull();
  });

  it("channels not live: the brief is stored, delivery is recorded as failed and never retried", async () => {
    const t = kit({ globals: WA });
    const now = await at(t, 15);
    const outbound = fakeOutbound();
    const d = { buddy: { outbound, now: () => now }, brief: noLlmBrief(now) };
    expect(ok(await cron(t, d))).toMatchObject({ processed: 1, created: 0 });
    const brief = await t.db.visit_brief.findOne({ visit_id: (await miltosVisit(t)).id });
    expect(brief!.status).toBe("failed");
    expect((await t.db.buddy_call.require(brief!.buddy_call_id!)).failure_reason).toMatch(/channels_not_live/);
    expect(outbound.sent).toHaveLength(0);
    expect(ok(await cron(t, d))).toMatchObject({ processed: 0 });
  });

  it("notify_channel=call inside call hours places one outbound call that carries the pre_visit purpose", async () => {
    const t = kit({ globals: LIVE });
    await t.db.app_user.update(IDS.nikos, { notify_channel: "call" });
    const now = await at(t, 25);
    const api = fakeApi();
    expect(ok(await cron(t, { buddy: { api, now: () => now }, brief: noLlmBrief(now) }))).toMatchObject({ processed: 1, created: 1 });
    const dials = api.calls.filter((c) => c.path === OUTBOUND_PATH);
    expect(dials).toHaveLength(1);
    expect(dials[0]!.body).toMatchObject({ to: NIKOS_PHONE });
    expect(dials[0]!.body.call_purpose).toMatch(/:pre_visit$/);
    expect((await t.db.visit_brief.findOne({ visit_id: (await miltosVisit(t)).id }))!.status).toBe("called");
  });

  it("dry_run counts the due visit without writing or sending", async () => {
    const t = kit({ globals: LIVE });
    const now = await at(t, 10);
    const outbound = fakeOutbound();
    expect(ok(await cron(t, { buddy: { outbound, now: () => now }, brief: noLlmBrief(now) }, { dry_run: true }))).toMatchObject({ processed: 1, created: 0 });
    expect(await t.db.visit_brief.findOne({ visit_id: (await miltosVisit(t)).id })).toBeNull();
    expect(outbound.sent).toHaveLength(0);
  });

  it("functions/previsit-briefs-due/handler.gen.js is the current bundle", async () => { await expectFreshBundle("previsit-briefs-due"); });
});
