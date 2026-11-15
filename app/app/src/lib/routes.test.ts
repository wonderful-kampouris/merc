import { describe, expect, it } from "vitest";
import appContract from "../contracts/app.json";
import manifest from "../../../wonderful.json";
import { canAccess, homeScreen, resolveRole, resolveRoute, SCREENS, screensFor } from "./routes";

const contractRoutes = Object.values(appContract.screens).flatMap((sh) => Object.values(sh).map((s) => s.route));

describe("routes from contracts/app/app.json", () => {
  it("has a screen for every contract route, with its function list", () => {
    expect(SCREENS.map((s) => s.route).sort()).toEqual([...contractRoutes].sort());
    expect(screensFor("rep")).toHaveLength(Object.keys(appContract.screens.rep).length);
    expect(screensFor("management")).toHaveLength(Object.keys(appContract.screens.management).length);
    expect(SCREENS.find((s) => s.route === "/rep/today")?.functions).toEqual(appContract.screens.rep.today.functions);
  });

  it("routes each role to its home and keeps reps out of management", () => {
    expect(homeScreen("rep").route).toBe("/rep/today");
    expect(homeScreen("manager").route).toBe("/mgmt/dashboard");
    expect(homeScreen("admin").route).toBe("/mgmt/dashboard");
    expect(resolveRoute("rep", "/mgmt/dashboard").route).toBe("/rep/today");
    expect(resolveRoute("rep", "/rep/week").route).toBe("/rep/week");
    expect(resolveRoute("manager", "/mgmt/settings/gdpr").route).toBe("/mgmt/settings/gdpr");
    expect(resolveRoute("manager", "/nowhere").route).toBe("/mgmt/dashboard");
    for (const r of contractRoutes) expect(canAccess("admin", r)).toBe(true);
    for (const s of screensFor("rep")) expect(canAccess("rep", s.route)).toBe(true);
    for (const s of screensFor("management")) expect(canAccess("rep", s.route)).toBe(false);
  });

  it("resolves the highest app role and defaults to the contract default", () => {
    expect(resolveRole(["rep", "manager"])).toBe("manager");
    expect(resolveRole(["admin"])).toBe("admin");
    expect(resolveRole([undefined, "member"])).toBe("rep");
  });

  it("marks rep screens and management approvals as mobile, Today and Record as offline", () => {
    expect(screensFor("rep").every((s) => s.mobile)).toBe(true);
    expect(SCREENS.filter((s) => s.shell === "management" && s.mobile).map((s) => s.key)).toEqual(["approvals"]);
    expect(SCREENS.filter((s) => s.offline).map((s) => s.route).sort()).toEqual(["/rep/record", "/rep/today"]);
  });
});

describe("wonderful.json role catalog", () => {
  it("matches the app contract's roles, permissions and relation scopes", () => {
    const cat = (manifest as unknown as { roles: { permissions: { key: string }[]; roles: { name: string; permission_grants: { permission: string; scope: { type: string; relation?: string } }[] }[]; default_role: string } }).roles;
    expect(cat.permissions.map((p) => p.key)).toEqual(appContract.permissions.map((p) => p.key));
    expect(cat.default_role).toBe(appContract.default_role);
    for (const [name, r] of Object.entries(appContract.roles)) {
      const role = cat.roles.find((x) => x.name === name)!;
      const got = role.permission_grants.map((g) => `${g.permission}@${g.scope.type === "all" ? "all" : g.scope.relation}`).sort();
      const want = [...r.all.map((p) => `${p}@all`), ...Object.entries(r.relation as Record<string, string[]>).flatMap(([rel, ps]) => ps.map((p) => `${p}@${rel}`))].sort();
      expect(got).toEqual(want);
    }
  });
});
