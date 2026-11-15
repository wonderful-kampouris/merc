import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsSystem, validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, HEADER_HOOK, makeImpl, opsPeriod } from "../src/weekly-summary";

const NOW = Date.parse("2026-11-16T05:00:00Z"); // Monday 07:00 Athens
const WIRED = { secrets: { MERC_OPS_WEEKLY_HOOK: "hook-key" }, globals: { MERC_OPS_WEEKLY_URL: "https://hooks.test/weekly" } };

function fakeFetch(status = 200) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const fetch = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: status < 300, status, json: async () => ({ data: { task_id: `task-${calls.length}` } }) };
  };
  return { calls, fetch };
}
const run = (t: ReturnType<typeof kit>, data: unknown, deps: Parameters<typeof makeImpl>[0]) =>
  runAsSystem("weekly-summary", makeImpl(deps), { tables: t.tables, data, orgId: IDS.org, platform: t.platform });

describe("fn:weekly-summary", () => {
  it("period is last Monday..Sunday in the org timezone", () => {
    expect(opsPeriod("weekly", "2026-11-16")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(opsPeriod("weekly", "2026-11-18")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
  });

  it("creates one merc-ops weekly_summary task per active manager and admin through the webhook", async () => {
    const t = kit(WIRED);
    const f = fakeFetch();
    const r = ok(await run(t, {}, { fetch: f.fetch, now: () => NOW }));
    expect(r).toMatchObject({ processed: 2, created: 2 });
    expect(f.calls.map((c) => c.body.recipient.name)).toEqual(["Thanasis Kyriakou", "Eleni Markou"]);
    for (const c of f.calls) {
      expect(c.url).toBe("https://hooks.test/weekly");
      expect(c.headers[HEADER_HOOK]).toBe("hook-key");
      expect(c.body).toMatchObject({ kind: "weekly", task_type: "weekly_summary", org_id: IDS.org, from: "2026-11-09", to: "2026-11-15" });
    }
    expect(f.calls[1]!.body.scope_user_id).toBe(IDS.eleni);
    expect((r.details as any).tasks.map((x: any) => x.task_id)).toEqual(["task-1", "task-2"]);
  });

  it("dry_run lists the recipients and posts nothing, even before the webhook is wired", async () => {
    const t = kit();
    const f = fakeFetch();
    const r = ok(await run(t, { dry_run: true }, { fetch: f.fetch, now: () => NOW }));
    expect(r).toMatchObject({ processed: 2, created: 0 });
    expect(f.calls).toHaveLength(0);
  });

  it("blocked_by_policy names the missing global and secret until the human step is done", async () => {
    const t = kit();
    const out = await run(t, {}, { fetch: fakeFetch().fetch, now: () => NOW });
    expect(errCode(out)).toBe("blocked_by_policy");
    expect((out as any).error.details.missing).toEqual(["MERC_OPS_WEEKLY_URL", "MERC_OPS_WEEKLY_HOOK"]);
  });

  it("a failing webhook is reported per task, not thrown", async () => {
    const t = kit(WIRED);
    const r = ok(await run(t, {}, { fetch: fakeFetch(500).fetch, now: () => NOW }));
    expect(r).toMatchObject({ processed: 2, created: 0 });
    expect((r.details as any).tasks.every((x: any) => x.status === "failed")).toBe(true);
  });

  it("left users are not emailed", async () => {
    const t = kit(WIRED);
    await t.db.app_user.update(IDS.eleni, { status: "left" });
    const f = fakeFetch();
    expect(ok(await run(t, {}, { fetch: f.fetch, now: () => NOW }))).toMatchObject({ processed: 1, created: 1 });
  });

  it("contract + cron entry: runs once per org, stray params dropped", async () => {
    const t = kit();
    expect(validateRequest("weekly-summary", { dry_run: true }).ok).toBe(true);
    expect(validateRequest("weekly-summary", { x: 1 }).ok).toBe(false);
    expect(validateResponse("weekly-summary", ok(await run(t, { dry_run: true }, { now: () => NOW }))).ok).toBe(true);
    const out = await handle({ tables: t.tables, data: { dry_run: true, extra: 1 }, metadata: {} } as never);
    expect(out).toMatchObject({ slug: "weekly-summary", orgs: 1, failed: 0 });
  });

  it("functions/weekly-summary/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "weekly-summary", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("weekly-summary"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
