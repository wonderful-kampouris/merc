import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsSystem, validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, makeImpl } from "../src/monthly-report";
import { opsPeriod } from "../src/weekly-summary";

const NOW = Date.parse("2026-12-01T05:00:00Z"); // 1 Dec 07:00 Athens
const WIRED = { secrets: { MERC_OPS_MONTHLY_HOOK: "m-key" }, globals: { MERC_OPS_MONTHLY_URL: "https://hooks.test/monthly" } };
const run = (t: ReturnType<typeof kit>, data: unknown, deps: Parameters<typeof makeImpl>[0]) =>
  runAsSystem("monthly-report", makeImpl(deps), { tables: t.tables, data, orgId: IDS.org, platform: t.platform });

describe("fn:monthly-report", () => {
  it("period is last calendar month", () => {
    expect(opsPeriod("monthly", "2026-12-01")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(opsPeriod("monthly", "2026-03-01")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("creates one monthly_report task per active admin only", async () => {
    const t = kit(WIRED);
    const bodies: any[] = [];
    const fetch = async (url: string, init: { headers: Record<string, string>; body: string }) => {
      expect(url).toBe("https://hooks.test/monthly");
      expect(init.headers["X-Webhook-Secret"]).toBe("m-key");
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ id: "t1" }) };
    };
    const r = ok(await run(t, {}, { fetch, now: () => NOW }));
    expect(r).toMatchObject({ processed: 1, created: 1 });
    expect(bodies[0]).toMatchObject({ kind: "monthly", task_type: "monthly_report", scope_user_id: IDS.thanasis, from: "2026-11-01", to: "2026-11-30" });
  });

  it("blocked until the monthly webhook is wired; dry_run works before", async () => {
    const t = kit();
    const out = await run(t, {}, { now: () => NOW });
    expect(errCode(out)).toBe("blocked_by_policy");
    expect((out as any).error.details.missing).toEqual(["MERC_OPS_MONTHLY_URL", "MERC_OPS_MONTHLY_HOOK"]);
    expect(ok(await run(t, { dry_run: true }, { now: () => NOW }))).toMatchObject({ processed: 1, created: 0 });
  });

  it("contract + cron entry", async () => {
    const t = kit();
    expect(validateRequest("monthly-report", { dry_run: null }).ok).toBe(true);
    expect(validateResponse("monthly-report", ok(await run(t, { dry_run: true }, { now: () => NOW }))).ok).toBe(true);
    expect(await handle({ tables: t.tables, data: { dry_run: true }, metadata: {} } as never)).toMatchObject({ slug: "monthly-report", orgs: 1, failed: 0 });
  });

  it("functions/monthly-report/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "monthly-report", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("monthly-report"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
