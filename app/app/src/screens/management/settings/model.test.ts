import { describe, expect, it } from "vitest";
import { changeCount, diffSettings, icpCriteria, parseSettings, permissionMatrix, setIcpWeight, setMode, validateSettings } from "./model";
import { mockClient, screenOf } from "./testkit";

const raw = {
  organization: { id: "o1", name: "Delta", briefing_time: "07:45", visits_per_day: 6, manager_call_enabled: true, icp_min_score: 60 },
  ai_permissions: [
    { role_code: "rep", action_type_code: "send_email", mode: "ask" },
    { role_code: "manager", action_type_code: "send_email", mode: "auto" },
    { role_code: "rep", action_type_code: "create_note", mode: "auto" },
    { role_code: "rep", action_type_code: "x", mode: "bogus" },
  ],
  alert_rules: [{ alert_type_code: "going_quiet", threshold_value: 1.5, window_days: null, enabled: true }],
  icp: { criteria: [{ criterion: "category_fit", weight: 3 }] },
  discount_policies: [{ id: "d1", role_code: "rep", max_discount_pct: 3, active: true }],
};

describe("settings model", () => {
  it("parses and drops invalid permission modes", () => {
    const s = parseSettings(raw);
    expect(s.ai_permissions).toHaveLength(3);
    const m = permissionMatrix(s.ai_permissions);
    expect(m.actions).toEqual(["send_email", "create_note"]);
    expect(m.roles).toEqual(["rep", "manager"]);
    expect(m.mode("rep", "send_email")).toBe("ask");
    expect(m.mode("manager", "create_note")).toBeNull();
  });
  it("REQ-SET-001: rep send_email -> never is sent as one changed row", () => {
    const before = parseSettings(raw);
    const after = { ...before, ai_permissions: setMode(before.ai_permissions, "rep", "send_email", "never") };
    const d = diffSettings(before, after);
    expect(d.ai_permissions).toEqual([{ role_code: "rep", action_type_code: "send_email", mode: "never" }]);
    expect(d.organization).toBeNull();
    expect(d.icp).toBeNull();
    expect(d.alert_rules).toEqual([]);
    expect(changeCount(d)).toBe(1);
  });
  it("diffs organization keys, alert rules, discounts and icp", () => {
    const before = parseSettings(raw);
    const after = {
      ...before,
      organization: { ...before.organization, visits_per_day: 7 },
      alert_rules: [{ ...before.alert_rules[0]!, enabled: false }],
      discount_policies: [{ ...before.discount_policies[0]!, max_discount_pct: 5 }],
      icp: setIcpWeight(before.icp, "category_fit", 4),
    };
    const d = diffSettings(before, after);
    expect(d.organization).toEqual({ visits_per_day: 7 });
    expect(d.alert_rules).toHaveLength(1);
    expect(d.discount_policies[0]).toMatchObject({ id: "d1", max_discount_pct: 5 });
    expect(icpCriteria(d.icp!)).toEqual([{ criterion: "category_fit", weight: 4 }]);
    expect(changeCount(d)).toBe(4);
    expect(diffSettings(before, before)).toEqual({ organization: null, ai_permissions: [], alert_rules: [], icp: null, discount_policies: [] });
  });
  it("validates values", () => {
    const s = parseSettings(raw);
    expect(validateSettings(s)).toEqual([]);
    const bad = { ...s, organization: { ...s.organization, briefing_time: "25:00", visits_per_day: 0 }, discount_policies: [{ ...s.discount_policies[0]!, max_discount_pct: 120 }] };
    expect(validateSettings(bad).map((p) => p.key)).toEqual(["briefing_time", "visits_per_day", "0"]);
  });
  it("round-trips through the mock client (only settings-get/settings-update)", async () => {
    const { client, calls } = mockClient(screenOf("/mgmt/settings"));
    const s = parseSettings(await client.call("settings-get", {}));
    expect(s.ai_permissions.length).toBeGreaterThan(0);
    const after = { ...s, ai_permissions: setMode(s.ai_permissions, "rep", s.ai_permissions[0]!.action_type_code, "never") };
    await expect(client.call("settings-update", diffSettings(s, after))).resolves.toEqual({ updated: true });
    await expect(client.call("users-list" as never, {} as never)).rejects.toMatchObject({ code: "forbidden" });
    expect(calls).toEqual(["settings-get", "settings-update", "users-list"]);
  });
});
