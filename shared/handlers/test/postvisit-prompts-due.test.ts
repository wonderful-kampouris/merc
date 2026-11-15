import { describe, expect, it } from "vitest";
import { runAsSystem, validateResponse } from "../../core/src/index";
import { kit, ok, IDS } from "../src/_lib/testkit";
import { makeImpl } from "../src/postvisit-prompts-due";
import { LIVE, NIKOS_PHONE, expectFreshBundle, fakeOutbound, iso, miltosVisit, type Kit } from "./meeting-loop-fixtures";

const cron = (t: Kit, deps: any, data: unknown = {}) =>
  runAsSystem("postvisit-prompts-due", makeImpl(deps), { tables: t.tables, data, orgId: IDS.org, platform: t.platform });
const startOf = async (t: Kit) => Date.parse((await miltosVisit(t)).planned_start_at!);

describe("fn:postvisit-prompts-due (REQ-MTG-005)", () => {
  it("planned end + 10 min passed with no debrief: one 'how did it go' prompt; a re-run sends nothing", async () => {
    const t = kit({ globals: LIVE });
    const now = (await startOf(t)) + 41 * 60_000; // 30 min visit + 10 min + 1
    const outbound = fakeOutbound();
    const r = ok(await cron(t, { outbound, now: () => now }));
    expect(validateResponse("postvisit-prompts-due", r).ok).toBe(true);
    expect(r).toMatchObject({ processed: 1, created: 1 });
    expect(outbound.sent).toHaveLength(1);
    expect(outbound.sent[0]).toMatchObject({ destination: NIKOS_PHONE });
    expect(JSON.stringify(outbound.sent[0].templateParams)).toMatch(/Café Miltos/);
    const v = await miltosVisit(t);
    expect((await t.db.buddy_call.all({ user_id: IDS.nikos, purpose: "post_visit" })).filter((c) => c.ref_id === v.id)).toHaveLength(1);
    expect(ok(await cron(t, { outbound, now: () => now + 5 * 60_000 }))).toMatchObject({ processed: 0, created: 0 });
    expect(outbound.sent).toHaveLength(1);
  });

  it("before the prompt time nothing is sent", async () => {
    const t = kit({ globals: LIVE });
    const outbound = fakeOutbound();
    const now = (await startOf(t)) + 35 * 60_000;
    expect(ok(await cron(t, { outbound, now: () => now }))).toMatchObject({ processed: 0, created: 0 });
    expect(outbound.sent).toHaveLength(0);
  });

  it("a visit already debriefed gets no prompt", async () => {
    const t = kit({ globals: LIVE });
    const start = await startOf(t);
    const v = await miltosVisit(t);
    await t.db.voice_log.insert({ rep_id: IDS.nikos, account_id: IDS.miltos, visit_id: v.id, capture_mode: "live_buddy", status: "completed", idempotency_key: "k-post-1", recorded_at: iso(start + 25 * 60_000) } as any);
    const outbound = fakeOutbound();
    expect(ok(await cron(t, { outbound, now: () => start + 60 * 60_000 }))).toMatchObject({ processed: 0, created: 0 });
    expect(outbound.sent).toHaveLength(0);
  });

  it("functions/postvisit-prompts-due/handler.gen.js is the current bundle", async () => { await expectFreshBundle("postvisit-prompts-due"); });
});
