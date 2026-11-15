import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { localDate, runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl, makeImpl } from "../src/targets-list";
import { kit, ok, errCode, IDS, DEMO_DAY } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const NOW = Date.parse(`${DEMO_DAY}T10:00:00Z`);
const h = makeImpl({ now: () => NOW });
// Seed targets (contracts/seed/sales_target.json), all for the current month.
const NIKOS_REV = "df8b5251-0f66-5a22-8012-06619f78afaf", NIKOS_VISITS = "a9aaac32-e868-50ce-b2cb-e0b784ab9aa0";
const NORTH_REV = "b7fe47bd-bf80-5196-bd9e-0699251809ce", ORG_REV = "99b82695-5adf-5bcb-a49b-ce55198c57f4";
const FROM = "2026-11-01", TO = "2026-11-30";

type Raw = Record<string, any>;
/** Hand query over the raw seed rows (no handler code), metrics.md#target-progress for a set of accounts. */
function handByAccounts(t: ReturnType<typeof kit>, accountFilter: (a: Raw) => boolean) {
  const rows = (tbl: string): Raw[] => [...(t.tables.rows.get(tbl as never)?.values() ?? [])];
  const accounts = rows("account").filter((a) => a.org_id === IDS.org && accountFilter(a));
  const accIds = new Set(accounts.map((a) => a.id));
  const orders = rows("sales_order").filter((o) => accIds.has(o.account_id) && o.status === "confirmed" && o.order_date >= FROM && o.order_date <= TO);
  const ids = new Set(orders.map((o) => o.id));
  const lines = rows("order_line").filter((l) => ids.has(l.order_id));
  const revenue = lines.reduce((s, l) => s + Math.round(l.quantity * l.unit_price_minor * (1 - (l.discount_pct ?? 0) / 100)), 0);
  const visits = rows("visit").filter((v) => accIds.has(v.account_id) && v.status === "done")
    .filter((v) => { const d = v.completed_at ? localDate("Europe/Athens", v.completed_at) : v.planned_date; return d >= FROM && d <= TO; }).length;
  return { revenue, visits };
}

describe("fn:targets-list (REQ-TGT-002)", () => {
  it("a rep sees own, territory and org targets with pct and days left from the query", async () => {
    const t = kit();
    const r = ok(await runAsTool("targets-list", h, t.toolCtx("nikos"), {}, t.key));
    expect(validateResponse("targets-list", r).ok).toBe(true);
    expect(r.items.map((x) => x.target_id)).toEqual([NIKOS_REV, NIKOS_VISITS, NORTH_REV, ORG_REV]);
    for (const x of r.items) expect(x).toMatchObject({ period_start: FROM, period_end: TO, days_left: 14 });

    const north = handByAccounts(t, (a) => a.territory_id === IDS.north);
    const org = handByAccounts(t, () => true);
    const nr = r.items.find((x) => x.target_id === NORTH_REV)!, or = r.items.find((x) => x.target_id === ORG_REV)!;
    expect(nr).toMatchObject({ target_value: 12000000, actual_value: north.revenue, pct: Math.round((1000 * north.revenue) / 12000000) / 10 });
    expect(or).toMatchObject({ target_value: 30000000, actual_value: org.revenue, pct: Math.round((1000 * org.revenue) / 30000000) / 10 });
    expect(org.revenue).toBeGreaterThanOrEqual(north.revenue);
    expect(north.revenue).toBeGreaterThan(0);
  });

  it("user targets match fn:my-performance (one rule, REQ-CORE-004)", async () => {
    const t = kit();
    const { makeImpl: perf } = await import("../src/my-performance");
    const p = ok(await runAsTool("my-performance", perf({ now: () => NOW }), t.toolCtx("nikos"), { period: "month" }, t.key));
    const r = ok(await runAsTool("targets-list", h, t.toolCtx("nikos"), {}, t.key));
    expect(r.items.filter((x) => p.targets.some((y) => y.target_id === x.target_id))).toEqual(p.targets);
  });

  it("scope: another rep's targets are hidden and rep_id outside scope is forbidden (REQ-CORE-009)", async () => {
    const t = kit();
    const d = ok(await runAsTool("targets-list", h, t.toolCtx("dimitra"), {}, t.key));
    expect(d.items.map((x) => x.target_id)).toEqual([NORTH_REV, ORG_REV]);
    expect(errCode(await runAsTool("targets-list", h, t.toolCtx("dimitra"), { rep_id: IDS.nikos }, t.key))).toBe("forbidden");
    // Manager drills into one rep; the admin sees everything.
    const e = ok(await runAsTool("targets-list", h, t.toolCtx("eleni"), { rep_id: IDS.nikos }, t.key));
    expect(e.items.map((x) => x.target_id)).toEqual([NIKOS_REV, NIKOS_VISITS]);
    const a = ok(await runAsTool("targets-list", h, t.toolCtx("thanasis"), {}, t.key));
    expect(a.items).toHaveLength(4);
    expect(errCode(await handle(t.fnCtx(null, {})))).toBe("forbidden");
  });

  it("period_start selects targets active on that date; a spoofed caller is ignored", async () => {
    const t = kit();
    const oct = ok(await runAsTool("targets-list", h, t.toolCtx("nikos"), { period_start: "2026-10-15" }, t.key));
    expect(oct.items).toEqual([]);
    const spoof = ok(await handle(t.fnCtx("dimitra", { caller: { user_id: IDS.nikos } })));
    expect(spoof.items.map((x) => x.target_id)).not.toContain(NIKOS_REV);
    expect(errCode(await runAsTool("targets-list", h, t.toolCtx("nikos"), { period_start: "nope" }, t.key))).toBe("validation_failed");
  });

  it("contract: request shapes validate", () => {
    expect(validateRequest("targets-list", { period_start: FROM, rep_id: IDS.nikos }).ok).toBe(true);
    expect(validateRequest("targets-list", {}).ok).toBe(true);
    expect(validateRequest("targets-list", { other: 1 }).ok).toBe(false);
  });

  it("deployed entry equals the tool path", async () => {
    const t = kit();
    expect(await runAsTool("targets-list", impl, t.toolCtx("nikos"), {}, t.key)).toEqual(ok(await handle(t.fnCtx("nikos", {}))));
  });

  it("functions/targets-list/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "targets-list", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("targets-list"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
