import { describe, expect, it } from "vitest";
import { actorUserId, assertNotSystem, canSeeAccount, createDb, defineCron, defineFunction, hasPermission, isSystem, listAccounts, meResponse, requireUser, runAsSystem, systemPrincipal } from "../src/index";
import { seeded, IDS, fnCtx } from "./fake-tables";

const rej = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as any; } throw new Error("expected rejection"); };

describe("systemPrincipal (scheduler / procedure callers)", () => {
  it("acts for one org with admin-wide scope and no user row", async () => {
    const f = seeded();
    const sys = await systemPrincipal(f, IDS.org);
    expect(sys).toMatchObject({ kind: "system", caller: "scheduler", role: "admin", org_id: IDS.org, user: null, manager: null });
    expect(sys.id).toBe(`system:${IDS.org}`);
    expect(isSystem(sys)).toBe(true);
    expect(actorUserId(sys)).toBeNull();
    expect(hasPermission(sys, "team.read")).toBe(true);
    expect(canSeeAccount(sys, { owner_rep_id: IDS.nikos })).toBe(true);
    expect((await listAccounts(createDb(f, IDS.org), sys, {}, { limit: 1000 })).total).toBe(40);
    expect((await systemPrincipal(f, IDS.org, "procedure")).caller).toBe("procedure");
  });

  it("unknown org -> not_found; empty org -> forbidden", async () => {
    const f = seeded();
    expect((await rej(systemPrincipal(f, "00000000-0000-4000-8000-000000000000"))).code).toBe("not_found");
    expect((await rej(systemPrincipal(f, ""))).code).toBe("forbidden");
  });

  it("never sends customer messages and cannot pose as a user", async () => {
    const sys = await systemPrincipal(seeded(), IDS.org);
    expect(() => assertNotSystem(sys)).toThrow(/system callers cannot send/);
    expect(() => requireUser(sys)).toThrow(/signed-in Merc user/);
  });

  it("runAsSystem runs a handler with the system principal; the app entry still needs a platform user", async () => {
    const f = seeded();
    const impl = async ({ me }: any) => (me.kind === "user" ? meResponse(me) : { error: "system" } as any);
    const out = await runAsSystem("me", impl, { tables: f, data: {}, orgId: IDS.org, checkResponse: false });
    expect(out).toEqual({ error: "system" });
    expect(await defineFunction("me", async ({ me }) => meResponse(me))({ ...fnCtx(null), tables: f })).toMatchObject({ error: { code: "forbidden" } });
  });

  it("defineCron runs once per organization", async () => {
    const f = seeded();
    const seen: string[] = [];
    const cron = defineCron("me", async ({ me }) => { seen.push(me.org_id); return {} as any; }, { checkResponse: false });
    const r = await cron({ tables: f, metadata: {} });
    expect(r.orgs).toBe(seen.length);
    expect(seen).toContain(IDS.org);
    expect(r.failed).toBe(0);
  });
});
