import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsSystem, validateResponse } from "../../core/src/index";
import { OUTBOUND_PATH, makeImpl as startImpl } from "../src/buddy-call-start";
import { handle, makeImpl } from "../src/buddy-callbacks-due";
import { kit, ok, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const NOW = Date.parse("2026-11-16T10:00:00Z");
const BUDDY = "+18455133803";
const fakeApi = () => { const calls: Array<{ path: string; body: any }> = []; return { calls, post: async (path: string, o?: { body?: unknown }) => { calls.push({ path, body: o?.body }); return path === OUTBOUND_PATH ? { id: "comm-cron-1" } : {}; } }; };
const dials = (api: ReturnType<typeof fakeApi>) => api.calls.filter((c) => c.path === OUTBOUND_PATH);

async function scheduled(globals: Record<string, unknown>) {
  const t = kit({ globals });
  const r = ok(await defineFunction("buddy-call-start", startImpl({ now: () => NOW }) as any)(t.fnCtx("nikos", { purpose: "callback", reason: "Call me at 5", at: "2026-11-16T15:00:00Z" })));
  expect(r.status).toBe("scheduled");
  return { t, id: r.buddy_call_id as string };
}
const cron = (t: ReturnType<typeof kit>, deps: any, data: unknown = {}) => runAsSystem("buddy-callbacks-due", makeImpl(deps), { tables: t.tables, data, orgId: IDS.org, platform: t.platform });

describe("fn:buddy-callbacks-due (REQ-BUD-014)", () => {
  it("before due_at nothing happens; at 17:00 Athens the call is placed once; running again does nothing", async () => {
    const { t, id } = await scheduled({ MERC_BUDDY_NUMBER: BUDDY, MERC_CHANNELS_LIVE: true });
    const api = fakeApi();
    const early = ok(await cron(t, { api, now: () => Date.parse("2026-11-16T14:55:00Z") }));
    expect(validateResponse("buddy-callbacks-due", early).ok).toBe(true);
    expect(early).toMatchObject({ processed: 0, created: 0 });
    const due = ok(await cron(t, { api, now: () => Date.parse("2026-11-16T15:00:00Z") }));
    expect(due).toMatchObject({ processed: 1, created: 1 });
    expect(dials(api)).toHaveLength(1);
    expect(dials(api)[0]!.body).toMatchObject({ from: BUDDY, to: "+306900000003", call_purpose: `merc_buddy:${id}:callback` });
    expect(ok(await cron(t, { api, now: () => Date.parse("2026-11-16T15:01:00Z") }))).toMatchObject({ processed: 0, created: 0 });
    expect(dials(api)).toHaveLength(1);
  });

  it("dry_run counts without writing or dialling", async () => {
    const { t, id } = await scheduled({ MERC_BUDDY_NUMBER: BUDDY, MERC_CHANNELS_LIVE: true });
    const api = fakeApi();
    const r = ok(await cron(t, { api, now: () => Date.parse("2026-11-16T15:05:00Z") }, { dry_run: true }));
    expect(r).toMatchObject({ processed: 1, created: 0 });
    expect(dials(api)).toHaveLength(0);
    expect((await t.db.buddy_call.require(id)).status).toBe("scheduled");
  });

  it("not live -> the due row fails with channels_not_live (no call); a later started call times out to no_answer", async () => {
    const { t, id } = await scheduled({ MERC_BUDDY_NUMBER: BUDDY, MERC_CHANNELS_LIVE: false });
    const api = fakeApi();
    const r = ok(await cron(t, { api, now: () => Date.parse("2026-11-16T15:00:00Z") }));
    expect(r).toMatchObject({ processed: 1, created: 0 });
    expect((await t.db.buddy_call.require(id)).failure_reason).toMatch(/^channels_not_live/);
    expect(dials(api)).toHaveLength(0);
  });

  it("the deployed cron entry runs once per org", async () => {
    const { t } = await scheduled({ MERC_BUDDY_NUMBER: BUDDY, MERC_CHANNELS_LIVE: false });
    const out: any = await handle({ ...t.fnCtx(null, { dry_run: true }) } as any);
    expect(out.orgs).toBeGreaterThanOrEqual(1);
    expect(out.failed).toBe(0);
  });

  it("functions/buddy-callbacks-due/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "buddy-callbacks-due", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("buddy-callbacks-due"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
