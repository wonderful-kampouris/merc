import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl } from "../src/settings-update";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const audits = (t: ReturnType<typeof kit>) => t.db.audit_event.all();

const base = { ai_permissions: [], alert_rules: [], discount_policies: [] };

describe("fn:settings-update (REQ-SET-001, REQ-CORE-010)", () => {
  it("rep send_email -> never: one permission_change audit row, row updated by natural key", async () => {
    const t = kit();
    const body = { ...base, ai_permissions: [{ role_code: "rep", action_type_code: "send_email", mode: "never" }] };
    expect(validateRequest("settings-update", body).ok).toBe(true);
    const r = ok(await handle(t.fnCtx("thanasis", body)));
    expect(r).toEqual({ updated: true });
    expect(validateResponse("settings-update", r).ok).toBe(true);
    expect((await t.db.ai_permission.findOne({ role_code: "rep", action_type_code: "send_email" }))!.mode).toBe("never");
    expect(await t.db.ai_permission.count()).toBe(72);
    const a = await audits(t);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ action: "permission_change", actor_id: IDS.thanasis, org_id: IDS.org });
  });

  it("partial org, alert rule, ICP and discount policy updates write exactly one settings_change", async () => {
    const t = kit();
    const pol = (await t.db.discount_policy.all())[0];
    const cats = (await t.db.account_category.all()).map((c) => c.id);
    const body = {
      organization: { visits_per_day: 9, briefing_time: "07:30" },
      ai_permissions: [], alert_rules: [{ alert_type_code: "going_quiet", threshold_value: 2 }],
      icp: { min_score: 70, criteria: [{ criterion: "near_route", weight: 5 }], category_ids: [cats[0]] },
      discount_policies: [{ id: pol.id, max_discount_pct: 4 }, { user_id: IDS.dimitra, max_discount_pct: 12 }],
    };
    ok(await handle(t.fnCtx("thanasis", body)));
    const org = await t.db.organization.get(IDS.org);
    expect(org).toMatchObject({ visits_per_day: 9, briefing_time: "07:30", icp_min_score: 70 });
    expect((await t.db.alert_rule.findOne({ alert_type_code: "going_quiet" }))!.threshold_value).toBe(2);
    expect((await t.db.icp_criterion.findOne({ criterion: "near_route" }))!.weight).toBe(5);
    expect((await t.db.icp_category.all()).map((c) => c.category_id)).toEqual([cats[0]]);
    expect((await t.db.discount_policy.get(pol.id))!.max_discount_pct).toBe(4);
    expect(await t.db.discount_policy.count()).toBe(5);
    const a = await audits(t);
    expect(a).toHaveLength(1);
    expect(a[0].action).toBe("settings_change");
  });

  it("empty update writes nothing; bad mode and unknown org fields are validation_failed", async () => {
    const t = kit();
    expect(ok(await handle(t.fnCtx("thanasis", base)))).toEqual({ updated: false });
    expect(errCode(await handle(t.fnCtx("thanasis", { ...base, ai_permissions: [{ role_code: "rep", action_type_code: "send_email", mode: "always" }] })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("thanasis", { ...base, organization: { id: "x" } })))).toBe("validation_failed");
    expect(await audits(t)).toHaveLength(0);
  });

  it("managers and reps are forbidden (settings.manage); spoofed caller ignored", async () => {
    const t = kit();
    const body = { ...base, ai_permissions: [{ role_code: "rep", action_type_code: "send_email", mode: "never" }] };
    expect(errCode(await handle(t.fnCtx("eleni", body)))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { ...body, caller: { user_id: IDS.thanasis, role: "admin" } })))).toBe("forbidden");
    expect(await audits(t)).toHaveLength(0);
  });

  it("functions/settings-update/handler.gen.js is the current bundle (run `pnpm bundle settings-update` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "settings-update", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("settings-update"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
