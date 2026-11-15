import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateResponse } from "../../core/src/index";
import { handle, impl } from "../src/me";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

describe("fn:me (REQ-CORE-002)", () => {
  it("resolves the platform caller to its app_user, territories, manager and permissions", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos")));
    expect(r.user).toEqual({ id: IDS.nikos, full_name: expect.any(String), role: "rep" });
    expect(r.org_id).toBe(IDS.org);
    expect(r.territory_ids).toContain(IDS.north);
    expect(r.manager?.id).toBe(IDS.eleni);
    expect(r.permissions).toContain("voicelog.create");
    expect(r.settings.timezone).toBeTruthy();
    expect(validateResponse("me", r).ok).toBe(true);
    expect(ok(await handle(t.fnCtx("eleni"))).user.role).toBe("manager");
  });

  it("ignores identity in the body: a spoofed caller changes nothing", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { caller: { user_id: IDS.thanasis, role: "admin" } })));
    expect(r.user.id).toBe(IDS.nikos);
  });

  it("no platform user -> forbidden; unknown user -> forbidden", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx(null)))).toBe("forbidden");
    const ctx = t.fnCtx(null);
    (ctx.metadata as any).user = { id: "wuid-nobody" };
    expect(errCode(await handle(ctx))).toBe("forbidden");
  });

  it("the buddy tool path runs the same impl with the signed claim", async () => {
    const t = kit();
    const viaTool = ok(await runAsTool("me", impl, t.toolCtx("nikos"), {}, t.key));
    expect(viaTool).toEqual(ok(await handle(t.fnCtx("nikos"))));
    expect(errCode(await runAsTool("me", impl, t.toolCtx("nikos", { key: "wrong" }), {}, t.key))).toBe("forbidden");
  });

  it("functions/me/handler.gen.js is the current bundle (run `pnpm bundle me` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "me", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("me"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
