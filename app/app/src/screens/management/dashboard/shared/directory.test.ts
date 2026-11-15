import { describe, expect, test } from "vitest";
import { createClient, MercApiError } from "../../../../lib/client";
import { SCREENS } from "../../../../lib/routes";
import { buildDirectory, directory, DIRECTORY_FUNCTIONS, loadDirectory, type TeamItem } from "./directory";

const NORTH = "76b55561-9135-5c55-ad43-34661bffd9d9";
const rep = (id: string, full_name: string, status = "active"): TeamItem => ({ user: { id, full_name, role: "rep" }, manager_id: null, territory_ids: [], status });
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

describe("directory", () => {
  test("seed fallback when nothing live", () => {
    const d = directory();
    expect(d.source).toBe("seed");
    expect(d.reps.length).toBeGreaterThanOrEqual(3);
    expect(d.name("territory", NORTH)).toBe("North");
  });

  test("live team-list and territories-list replace the seed lists, sorted, inactive and non-reps dropped", () => {
    const team = [rep(B, "Zoe"), rep(A, "Alex"), rep("00000000-0000-4000-8000-00000000000c", "Gone", "inactive"), { ...rep("00000000-0000-4000-8000-00000000000d", "Mgr"), user: { id: "00000000-0000-4000-8000-00000000000d", full_name: "Mgr", role: "manager" as const } }];
    const d = buildDirectory({ team, territories: [{ id: "t1", name: "West" }, { id: NORTH, name: "Βορράς" }, { id: "t2" }] });
    expect(d.source).toBe("live");
    expect(d.reps.map((r) => r.name)).toEqual(["Alex", "Zoe"]);
    expect(d.territories.map((t) => t.name)).toEqual(["West", "Βορράς"]);
    expect(d.name("user", A)).toBe("Alex");
    expect(d.name("user", "00000000-0000-4000-8000-00000000000d")).toBe("Mgr");
    expect(d.name("territory", NORTH)).toBe("Βορράς");
  });

  test("an empty live list keeps the seed for that list only", () => {
    const d = buildDirectory({ team: [], territories: [{ id: "t1", name: "West" }] });
    expect(d.reps).toEqual(directory().reps);
    expect(d.territories).toEqual([{ id: "t1", name: "West" }]);
  });

  for (const route of ["/mgmt/dashboard", "/mgmt/pipeline", "/mgmt/targets", "/mgmt/competition"]) {
    test(`${route} lists team-list and territories-list and loads them in mock mode`, async () => {
      const screen = SCREENS.find((s) => s.route === route)!;
      for (const f of DIRECTORY_FUNCTIONS) expect(screen.functions).toContain(f);
      const client = createClient({ mock: true, invoker: { invokeFunction: async () => ({}) } }).forScreen(screen.functions);
      const d = await loadDirectory(client, screen.functions);
      expect(d.source).toBe("live");
      expect(d.reps.length).toBeGreaterThan(0);
      expect(d.territories.length).toBeGreaterThan(0);
    });
  }

  test("a failing call degrades to the seed and never throws", async () => {
    const client = { call: async () => Promise.reject(new MercApiError("team-list", { code: "internal", message: "down" })) } as never;
    const d = await loadDirectory(client, [...DIRECTORY_FUNCTIONS]);
    expect(d.source).toBe("seed");
    expect(d.reps).toEqual(directory().reps);
  });

  test("functions not in the screen list are not called", async () => {
    const calls: string[] = [];
    const client = { call: async (slug: string) => (calls.push(slug), { items: [] }) } as never;
    await loadDirectory(client, ["targets-list"]);
    expect(calls).toEqual([]);
  });
});
