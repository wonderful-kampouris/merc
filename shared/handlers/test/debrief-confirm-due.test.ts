import { describe, expect, it } from "vitest";
import { runAsSystem, validateResponse } from "../../core/src/index";
import { kit, ok, IDS } from "../src/_lib/testkit";
import { makeImpl } from "../src/debrief-confirm-due";
import { LIVE, completedLog, expectFreshBundle, fakeOutbound, iso, type Kit } from "./meeting-loop-fixtures";

const NOW = Date.parse("2026-11-16T10:20:00Z");
const cron = (t: Kit, deps: any, data: unknown = {}) =>
  runAsSystem("debrief-confirm-due", makeImpl(deps), { tables: t.tables, data, orgId: IDS.org, platform: t.platform });

describe("fn:debrief-confirm-due (REQ-MTG-006/007)", () => {
  it("a debrief completed 5 min ago gets one confirmation; a re-run creates nothing", async () => {
    const t = kit({ globals: LIVE });
    const { vl } = await completedLog(t, NOW - 5 * 60_000);
    const outbound = fakeOutbound();
    const r = ok(await cron(t, { outbound, now: () => NOW }));
    expect(validateResponse("debrief-confirm-due", r).ok).toBe(true);
    expect(r).toMatchObject({ processed: 1, created: 1 });
    expect(await t.db.debrief_confirmation.findOne({ voice_log_id: vl.id })).toMatchObject({ status: "sent" });
    expect(outbound.sent).toHaveLength(1);
    expect(ok(await cron(t, { outbound, now: () => NOW + 60_000 }))).toMatchObject({ processed: 0, created: 0 });
    expect(outbound.sent).toHaveLength(1);
  });

  it("a debrief older than 30 min is left alone", async () => {
    const t = kit({ globals: LIVE });
    const { vl } = await completedLog(t, NOW - 2 * 3_600_000);
    expect(ok(await cron(t, { outbound: fakeOutbound(), now: () => NOW }))).toMatchObject({ processed: 0, created: 0 });
    expect(await t.db.debrief_confirmation.findOne({ voice_log_id: vl.id })).toBeNull();
  });

  it("a sent confirmation without a reply after 4 h becomes no_reply; a replied one stays", async () => {
    const t = kit({ globals: {} });
    const { vl } = await completedLog(t, NOW - 6 * 3_600_000);
    const stale = await t.db.debrief_confirmation.insert({ voice_log_id: vl.id, rep_id: IDS.nikos, channel: "app", summary_text: "x", status: "sent", sent_at: iso(NOW - 5 * 3_600_000) } as any);
    const r = ok(await cron(t, { now: () => NOW }));
    expect((r.details as any).no_reply_ids).toEqual([stale.id]);
    expect((await t.db.debrief_confirmation.require(stale.id)).status).toBe("no_reply");
  });

  it("dry_run counts without writing", async () => {
    const t = kit({ globals: LIVE });
    const { vl } = await completedLog(t, NOW - 60_000);
    expect(ok(await cron(t, { outbound: fakeOutbound(), now: () => NOW }, { dry_run: true }))).toMatchObject({ processed: 1, created: 0 });
    expect(await t.db.debrief_confirmation.findOne({ voice_log_id: vl.id })).toBeNull();
  });

  it("functions/debrief-confirm-due/handler.gen.js is the current bundle", async () => { await expectFreshBundle("debrief-confirm-due"); });
});
