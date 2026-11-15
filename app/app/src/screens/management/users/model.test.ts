import { describe, expect, it } from "vitest";
import { objArr, withMockSeed } from "../settings/kit";
import { mockClient, screenOf } from "../settings/testkit";
import { emptyUserForm, formFromUser, managerOptions, parseUsers, seedTerritories, toUpsert, validateUser } from "./model";

const ELENI = "fa4c7746-c253-5104-a735-7060bfddb756";

describe("users model", () => {
  it("parses, sorts admins first and blocks edits without territories", () => {
    const us = parseUsers([
      { id: "r", full_name: "Rep A", email: "a@x.gr", role_code: "rep", status: "active" },
      { id: "m", full_name: "Mgr", email: "m@x.gr", role_code: "manager", status: "active", territory_ids: [] },
      { id: "z", full_name: "Bad", role_code: "ceo" },
      {},
    ]);
    expect(us.map((u) => u.id)).toEqual(["m", "r"]);
    expect(formFromUser(us[1]!)).toBeNull();
    expect(formFromUser(us[0]!)).toMatchObject({ user_id: "m", territory_ids: [] });
    expect(managerOptions(us, "m")).toEqual([]);
    expect(managerOptions(us, "r").map((u) => u.id)).toEqual(["m"]);
  });
  it("REQ-SET-002: inviting a rep needs name, email and a manager", () => {
    expect(validateUser(emptyUserForm())).toEqual(["full_name", "email", "manager"]);
    const f = { ...emptyUserForm(), full_name: " Maria P ", email: "Maria@Delta.GR ", manager_id: ELENI, phone: "+30 690 000 0009" };
    expect(validateUser(f)).toEqual([]);
    expect(toUpsert(f)).toEqual({ user_id: null, email: "maria@delta.gr", full_name: "Maria P", role_code: "rep", manager_id: ELENI, phone: "+306900000009", territory_ids: [], status: "active" });
    expect(validateUser({ ...f, phone: "abc" })).toEqual(["phone"]);
  });
  it("mock mode shows the seed team, with territory memberships", async () => {
    const { client, calls } = mockClient(screenOf("/mgmt/users"));
    const parsed = parseUsers(objArr((await client.call("users-list", {})).items));
    const us = seedTerritories(withMockSeed(true, parsed, "app_user", parseUsers));
    expect(us.length).toBe(6);
    expect(us.every((u) => formFromUser(u))).toBe(true);
    const r = await client.call("user-upsert", toUpsert({ ...emptyUserForm(), full_name: "Test Rep", email: "t@x.gr", manager_id: ELENI }));
    expect(r).toHaveProperty("invited");
    expect(calls).toEqual(["users-list", "user-upsert"]);
  });
});
