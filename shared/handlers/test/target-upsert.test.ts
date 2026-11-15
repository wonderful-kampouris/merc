import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl, makeImpl } from "../src/target-upsert";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const h = makeImpl({ now: () => Date.parse("2026-11-16T10:00:00Z") });
const NIKOS_REV = "df8b5251-0f66-5a22-8012-06619f78afaf";
const DEC = { period_start: "2026-12-01", period_end: "2026-12-31" };
type Raw = Record<string, any>;
const rows = (t: ReturnType<typeof kit>, tbl: string): Raw[] => [...(t.tables.rows.get(tbl as never)?.values() ?? [])];

describe("fn:target-upsert (REQ-TGT-001)", () => {
  it("a manager creates targets per rep, territory and org; each write is audited", async () => {
    const t = kit();
    const reqs = [
      { scope: "user", user_id: IDS.nikos, metric: "revenue", ...DEC, target_value: 2000000 },
      { scope: "territory", territory_id: IDS.north, metric: "visits", ...DEC, target_value: 300 },
      { scope: "org", metric: "new_customers", ...DEC, target_value: 12 },
      { scope: "user", user_id: IDS.dimitra, metric: "volume", ...DEC, target_value: 450.5 },
    ];
    for (const req of reqs) {
      expect(validateRequest("target-upsert", req).ok).toBe(true);
      const r = ok(await runAsTool("target-upsert", h, t.toolCtx("eleni"), req, t.key));
      expect(validateResponse("target-upsert", r).ok).toBe(true);
      const row = await t.db.sales_target.require(r.target_id);
      expect(row).toMatchObject({ metric: req.metric, period_start: DEC.period_start, period_end: DEC.period_end, target_value: req.target_value, set_by: IDS.eleni,
        user_id: (req as Raw).user_id ?? null, territory_id: (req as Raw).territory_id ?? null });
      const audit = rows(t, "audit_event").filter((a) => a.target_id === r.target_id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_id: IDS.eleni, action: "target_change", target_table: "sales_target" });
      expect(JSON.parse(audit[0].detail)).toMatchObject({ op: "create", scope: req.scope });
    }
  });

  it("an overlapping duplicate is rejected; a different metric or adjacent period is fine", async () => {
    const t = kit();
    // The seed already has nikos revenue for November.
    const dup = await runAsTool("target-upsert", h, t.toolCtx("eleni"), { scope: "user", user_id: IDS.nikos, metric: "revenue", period_start: "2026-11-15", period_end: "2026-12-15", target_value: 100 }, t.key);
    expect(errCode(dup)).toBe("conflict");
    expect((dup as any).error.details).toMatchObject({ target_id: NIKOS_REV });
    const orgDup = await runAsTool("target-upsert", h, t.toolCtx("thanasis"), { scope: "org", metric: "revenue", period_start: "2026-11-30", period_end: "2026-11-30", target_value: 1 }, t.key);
    expect(errCode(orgDup)).toBe("conflict");
    ok(await runAsTool("target-upsert", h, t.toolCtx("eleni"), { scope: "user", user_id: IDS.nikos, metric: "volume", period_start: "2026-11-01", period_end: "2026-11-30", target_value: 500 }, t.key));
    ok(await runAsTool("target-upsert", h, t.toolCtx("eleni"), { scope: "user", user_id: IDS.nikos, metric: "revenue", ...DEC, target_value: 100 }, t.key));
    // Same metric and period on another scope is not a duplicate.
    ok(await runAsTool("target-upsert", h, t.toolCtx("eleni"), { scope: "user", user_id: IDS.dimitra, metric: "revenue", period_start: "2026-11-01", period_end: "2026-11-30", target_value: 100 }, t.key));
  });

  it("update: edits the target in place (not a clash with itself), audits the previous value", async () => {
    const t = kit();
    const r = ok(await runAsTool("target-upsert", h, t.toolCtx("eleni"), { target_id: NIKOS_REV, scope: "user", user_id: IDS.nikos, metric: "revenue", period_start: "2026-11-01", period_end: "2026-11-30", target_value: 2000000 }, t.key));
    expect(r.target_id).toBe(NIKOS_REV);
    expect((await t.db.sales_target.require(NIKOS_REV)).target_value).toBe(2000000);
    const audit = rows(t, "audit_event").find((a) => a.target_id === NIKOS_REV)!;
    expect(JSON.parse(audit.detail)).toMatchObject({ op: "update", previous: { target_value: 1800000 } });
    expect(errCode(await runAsTool("target-upsert", h, t.toolCtx("eleni"), { target_id: "00000000-0000-4000-8000-000000000000", scope: "org", metric: "revenue", ...DEC, target_value: 1 }, t.key))).toBe("not_found");
  });

  it("validation: exactly one scope, ordered dates, positive whole values", async () => {
    const t = kit();
    const bad = [
      { scope: "org", user_id: IDS.nikos, metric: "revenue", ...DEC, target_value: 1 },
      { scope: "user", metric: "revenue", ...DEC, target_value: 1 },
      { scope: "territory", territory_id: IDS.north, user_id: IDS.nikos, metric: "revenue", ...DEC, target_value: 1 },
      { scope: "org", metric: "revenue", period_start: "2026-12-31", period_end: "2026-12-01", target_value: 1 },
      { scope: "org", metric: "visits", ...DEC, target_value: 0 },
      { scope: "org", metric: "visits", ...DEC, target_value: 2.5 },
      { scope: "org", metric: "margin", ...DEC, target_value: 1 },
    ];
    for (const req of bad) expect(errCode(await runAsTool("target-upsert", h, t.toolCtx("eleni"), req, t.key))).toBe("validation_failed");
    expect(errCode(await runAsTool("target-upsert", h, t.toolCtx("eleni"), { scope: "user", user_id: "00000000-0000-4000-8000-000000000000", metric: "revenue", ...DEC, target_value: 1 }, t.key))).toBe("validation_failed");
  });

  it("scope: reps cannot set targets (gate targets.manage); a manager only for their team; spoofed caller ignored", async () => {
    const t = kit();
    const req = { scope: "user", user_id: IDS.nikos, metric: "revenue", ...DEC, target_value: 1 };
    expect(errCode(await runAsTool("target-upsert", h, t.toolCtx("nikos"), req, t.key))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", req)))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx(null, req)))).toBe("forbidden");
    // The admin is not in Eleni's team.
    expect(errCode(await runAsTool("target-upsert", h, t.toolCtx("eleni"), { ...req, user_id: IDS.thanasis }, t.key))).toBe("forbidden");
    ok(await runAsTool("target-upsert", h, t.toolCtx("thanasis"), { ...req, user_id: IDS.eleni }, t.key));
    // `caller` in the body is dropped before the impl runs: set_by is the real caller.
    const r = ok(await handle(t.fnCtx("eleni", { ...req, user_id: IDS.dimitra, caller: { user_id: IDS.thanasis } })));
    expect((await t.db.sales_target.require(r.target_id)).set_by).toBe(IDS.eleni);
    expect(rows(t, "sales_target").filter((x) => x.user_id === IDS.nikos && x.period_start === DEC.period_start)).toHaveLength(0);
  });

  it("deployed entry equals the tool path (same outcome on a fresh kit)", async () => {
    const req = { scope: "org", metric: "visits", ...DEC, target_value: 900 };
    const a = ok(await runAsTool("target-upsert", impl, kit().toolCtx("eleni"), req, "test-internal-call-key"));
    const b = ok(await handle(kit().fnCtx("eleni", req)));
    expect(Object.keys(a)).toEqual(Object.keys(b));
  });

  it("functions/target-upsert/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "target-upsert", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("target-upsert"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
