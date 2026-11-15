import { describe, expect, it } from "vitest";
import { callerFromTool, createDb, defineFunction, isAdmin, me, meResponse, principalFromFunction, principalFromTool, resolvePrincipal, runAsTool, signIdentity, validateResponse, IDENTITY_KEYS } from "../src/index";
import { validateResponse as contractValidateResponse } from "../../../packages/contracts/src/index";
import { seeded, IDS, fnCtx } from "./fake-tables";

const KEY = "test-internal-call-key";
const rej = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as any; } throw new Error("expected rejection"); };
const toolCtx = (tables: any, md: Record<string, unknown>) => ({ tables, metadata: { communication: { metadata: md } } });

describe("me(): platform caller -> app_user (REQ-CORE-002)", () => {
  it("resolves a rep from context.metadata.user and matches the fn:me contract", async () => {
    const res = await me(seeded(), fnCtx("wuid-nikos"));
    expect(res.user).toEqual({ id: IDS.nikos, full_name: "Nikos Alexiou", role: "rep" });
    expect(res.org_id).toBe(IDS.org);
    expect(res.territory_ids).toEqual([IDS.north]);
    expect(res.manager?.id).toBe(IDS.eleni);
    expect(res.settings).toEqual({ briefing_time: "07:45", timezone: "Europe/Athens", currency: "EUR" });
    expect(res.permissions).toContain("accounts.read");
    expect(res.permissions).not.toContain("team.read");
    expect(validateResponse("me", res).ok).toBe(true);
    expect(contractValidateResponse("me", res).ok).toBe(true);
  });

  it("computes a manager's team and team territories", async () => {
    const p = await principalFromFunction(seeded(), fnCtx("wuid-eleni"));
    expect(p.role).toBe("manager");
    expect(p.team_user_ids).toEqual(expect.arrayContaining([IDS.nikos, IDS.dimitra, IDS.center_rep]));
    expect(p.team_user_ids).not.toContain(IDS.thanasis);
    expect(p.team_territory_ids).toEqual(expect.arrayContaining([IDS.north, IDS.center]));
    expect(meResponse(p).permissions).toContain("team.read");
  });

  it("forbids calls without a platform user, unknown users and inactive users", async () => {
    const f = seeded();
    expect((await rej(me(f, fnCtx(null)))).code).toBe("forbidden");
    expect((await rej(me(f, fnCtx("wuid-stranger")))).code).toBe("forbidden");
    await createDb(f, IDS.org).app_user.update(IDS.dimitra, { status: "left" });
    expect((await rej(me(f, fnCtx("wuid-dimitra")))).code).toBe("forbidden");
  });

  it("open demo mode: an active \"open-access\" guest row removes roles and admits unknown platform users", async () => {
    const f = seeded();
    await createDb(f, IDS.org).app_user.insert({ org_id: IDS.org, wonderful_user_id: "open-access", role_code: "admin", full_name: "Demo guest", email: "guest@merc-demo.example", voice_enabled: false, status: "active" } as any);
    const guest = await me(f, fnCtx("wuid-stranger"));
    expect(guest.user.full_name).toBe("Demo guest");
    expect((await me(f, fnCtx("wuid-nikos"))).permissions).toContain("team.read");
    expect(isAdmin(await resolvePrincipal(f, { kind: "wonderful_user", wonderfulUserId: "wuid-nikos" }))).toBe(true);
    expect((await rej(me(f, fnCtx(null)))).code).toBe("forbidden");
  });

  it("ignores a spoofed caller in the body", async () => {
    const f = seeded();
    const fn = defineFunction("me", async ({ me: p }) => meResponse(p));
    const out: any = await fn({ tables: f, ...fnCtx("wuid-nikos", { caller: { user_id: IDS.thanasis, role: "admin" } }) });
    expect(out.user.id).toBe(IDS.nikos);
    expect(out.user.role).toBe("rep");
    const noUser: any = await fn({ tables: f, ...fnCtx(null, { caller: { user_id: IDS.thanasis } }) });
    expect(noUser.error.code).toBe("forbidden");
  });

  it("tool path: verifies the signed session identity", async () => {
    const f = seeded();
    const now = Date.UTC(2026, 10, 16, 8);
    const claims = signIdentity(KEY, { app_user_id: IDS.nikos, org_id: IDS.org, now, ttlSeconds: 600 });
    const p = await principalFromTool(f, toolCtx(f, { ...claims, "wonderful.customer_user.id": IDS.nikos }), KEY, now);
    expect(p.id).toBe(IDS.nikos);
    // same implementation, voice entry point (fresh claim, real clock)
    const fresh = signIdentity(KEY, { app_user_id: IDS.nikos, org_id: IDS.org });
    const ok: any = await runAsTool("me", async ({ me: x }) => meResponse(x), toolCtx(f, fresh) as any, { caller: { user_id: IDS.thanasis } }, KEY);
    expect(ok.user.id).toBe(IDS.nikos);
  });

  it("tool path: rejects missing, tampered, expired and mismatched identities", () => {
    const now = 1_800_000_000_000;
    const c = signIdentity(KEY, { app_user_id: IDS.nikos, org_id: IDS.org, now, ttlSeconds: 60 });
    const code = (fn: () => unknown) => { try { fn(); } catch (e: any) { return e.code; } return "ok"; };
    expect(code(() => callerFromTool({ metadata: { communication: { metadata: {} } } }, KEY, now))).toBe("forbidden");
    expect(code(() => callerFromTool({ metadata: { communication: { metadata: { ...c, [IDENTITY_KEYS.uid]: IDS.thanasis } } } }, KEY, now))).toBe("forbidden");
    expect(code(() => callerFromTool({ metadata: { communication: { metadata: c } } }, "wrong-key", now))).toBe("forbidden");
    expect(code(() => callerFromTool({ metadata: { communication: { metadata: c } } }, KEY, now + 61_000))).toBe("forbidden");
    expect(code(() => callerFromTool({ metadata: { communication: { metadata: { ...c, wonderful: { customer_user: { id: IDS.dimitra } } } } } }, KEY, now))).toBe("forbidden");
    expect(code(() => callerFromTool({ metadata: { communication: { metadata: c } } }, KEY, now))).toBe("ok");
  });
});
