import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsSystem, validateResponse } from "../../core/src/index";
import { handle, makeImpl } from "../src/approval-sla-watch";
import { makeImpl as requestImpl } from "../src/discount-request";
import { handle as decide } from "../src/approval-decide";
import { OUTBOUND_PATH } from "../src/discount-check";
import { kit, ok, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const ESPRESSO = "120d56dc-215d-557d-bbab-43d87e1047c4";
const NOW = Date.parse("2026-11-16T10:00:00Z");
const fakeApi = () => { const calls: Array<{ path: string; body: any }> = []; return { calls, post: async (path: string, o?: { body?: unknown }) => { calls.push({ path, body: o?.body }); return path === OUTBOUND_PATH ? { id: "c1" } : {}; } }; };
const watch = (t: ReturnType<typeof kit>, now: number, data: unknown = {}, api?: ReturnType<typeof fakeApi>) =>
  runAsSystem("approval-sla-watch", makeImpl({ api, now: () => now }), { tables: t.tables, data, orgId: IDS.org });

async function overdue(mode: "async" | "live" = "async", init: Parameters<typeof kit>[0] = {}) {
  const t = kit(init);
  const api = fakeApi();
  const r = ok(await defineFunction("discount-request", requestImpl({ api, now: () => NOW }))(t.fnCtx("nikos", { account_id: IDS.miltos, discount_pct: 8, lines: [{ product_id: ESPRESSO, quantity: 20 }], mode })));
  return { t, r, api };
}

describe("fn:approval-sla-watch (REQ-DSC-007, metrics.md#approval-sla)", () => {
  it("an overdue async request escalates to Thanasis with an approval_overdue alert; SMS is reported as skipped", async () => {
    const { t, r } = await overdue();
    expect(ok(await watch(t, NOW + 30 * 60_000))).toMatchObject({ processed: 0, created: 0 }); // not due yet
    const api = fakeApi();
    const out = ok(await watch(t, NOW + 61 * 60_000, {}, api));
    expect(validateResponse("approval-sla-watch", out).ok).toBe(true);
    expect(out).toMatchObject({ processed: 1, created: 1, details: { escalated: [{ approval_id: r.approval_id, from: IDS.eleni, to: IDS.thanasis }], sms: expect.stringMatching(/skipped/) } });
    expect(await t.db.approval.require(r.approval_id)).toMatchObject({ status: "escalated", approver_id: IDS.thanasis });
    expect(await t.db.alert.findOne({ dedupe_key: `approval_overdue:${r.approval_id}` })).toMatchObject({ alert_type_code: "approval_overdue", recipient_id: IDS.thanasis, severity: "high", account_id: IDS.miltos });
    expect(api.calls.some((c) => c.body?.channel === `rep:${IDS.thanasis}`)).toBe(true);
    expect(ok(await watch(t, NOW + 200 * 60_000))).toMatchObject({ processed: 0, created: 0 }); // escalated once
    expect(ok(await decide(t.fnCtx("thanasis", { approval_id: r.approval_id, decision: "approve", via: "app" }))).approval.status).toBe("approved");
  });

  it("dry_run changes nothing", async () => {
    const { t, r } = await overdue();
    const out = ok(await watch(t, NOW + 61 * 60_000, { dry_run: true }));
    expect(out).toMatchObject({ processed: 1, created: 0 });
    expect((await t.db.approval.require(r.approval_id)).status).toBe("pending");
    expect(await t.db.alert.count()).toBe(0);
  });

  it("times out a live call with no outcome after 90 s (async fallback)", async () => {
    const { t, r } = await overdue("live", { globals: { MERC_APPROVER_CALLER_ID: "+12025550100" } });
    expect(r.mode).toBe("live");
    const out = ok(await watch(t, NOW + 91_000));
    expect(out.details).toMatchObject({ timed_out_calls: [r.manager_call_id] });
    expect(await t.db.approval.require(r.approval_id)).toMatchObject({ mode: "async", status: "pending" });
  });

  it("the cron entry runs once per organization with a system principal", async () => {
    const t = kit();
    const out: any = await handle({ tables: t.tables, data: {}, secrets: t.platform.secrets, globals: t.platform.globals } as any);
    expect(out).toMatchObject({ slug: "approval-sla-watch", orgs: 1, failed: 0 });
  });

  it("functions/approval-sla-watch/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "approval-sla-watch", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("approval-sla-watch"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
