import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl } from "../src/user-upsert";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const audits = (t: ReturnType<typeof kit>) => t.db.audit_event.all();

describe("fn:user-upsert (REQ-SET-002, REQ-CORE-010)", () => {
  it("invites a new rep: app_user with invite placeholder, territory link, one user_change audit", async () => {
    const t = kit();
    const body = { email: "Kostas@Merc-Demo.example", full_name: "Kostas Rep", role_code: "rep", manager_id: IDS.eleni, territory_ids: [IDS.north] };
    expect(validateRequest("user-upsert", body).ok).toBe(true);
    const r = ok(await handle(t.fnCtx("thanasis", body)));
    expect(r.invited).toBe(true);
    expect(validateResponse("user-upsert", r).ok).toBe(true);
    const u = (await t.db.app_user.get(r.user_id))!;
    expect(u).toMatchObject({ email: "kostas@merc-demo.example", role_code: "rep", status: "active", wonderful_user_id: "invite:kostas@merc-demo.example" });
    expect((await t.db.territory_rep.all({ user_id: r.user_id })).map((l) => l.territory_id)).toEqual([IDS.north]);
    const a = await audits(t);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ action: "user_change", target_table: "app_user", target_id: r.user_id });
    // the invited user shows as pending in users-list
    const { handle: list } = await import("../src/users-list");
    expect((ok(await list(t.fnCtx("thanasis"))).items as any[]).find((x) => x.id === r.user_id).invite_pending).toBe(true);
  });

  it("edits an existing user: role, territories replaced, status left", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("thanasis", { user_id: IDS.dimitra, email: (await t.db.app_user.get(IDS.dimitra))!.email, full_name: "Dimitra X", role_code: "rep", manager_id: IDS.eleni, territory_ids: [IDS.center], status: "left" })));
    expect(r).toEqual({ user_id: IDS.dimitra, invited: false });
    expect((await t.db.app_user.get(IDS.dimitra))!.status).toBe("left");
    expect((await t.db.territory_rep.all({ user_id: IDS.dimitra })).map((l) => l.territory_id)).toEqual([IDS.center]);
    expect(await audits(t)).toHaveLength(1);
  });

  it("duplicate email -> conflict; bad manager -> validation_failed; self-demotion refused", async () => {
    const t = kit();
    const nikos = (await t.db.app_user.get(IDS.nikos))!;
    expect(errCode(await handle(t.fnCtx("thanasis", { email: nikos.email.toUpperCase(), full_name: "X", role_code: "rep", territory_ids: [] })))).toBe("conflict");
    expect(errCode(await handle(t.fnCtx("thanasis", { email: "a@b.example", full_name: "X", role_code: "rep", manager_id: IDS.nikos, territory_ids: [] })))).toBe("validation_failed");
    const me = (await t.db.app_user.get(IDS.thanasis))!;
    expect(errCode(await handle(t.fnCtx("thanasis", { user_id: IDS.thanasis, email: me.email, full_name: me.full_name, role_code: "rep", territory_ids: [] })))).toBe("validation_failed");
    expect(await audits(t)).toHaveLength(0);
  });

  it("only admins; spoofed caller ignored", async () => {
    const t = kit();
    const body = { email: "z@z.example", full_name: "Z", role_code: "admin", territory_ids: [], caller: { user_id: IDS.thanasis, role: "admin" } };
    expect(errCode(await handle(t.fnCtx("eleni", body)))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", body)))).toBe("forbidden");
    expect(errCode(await runAsTool("user-upsert", impl, t.toolCtx("nikos"), body, t.key))).toBe("forbidden");
  });

  it("functions/user-upsert/handler.gen.js is the current bundle (run `pnpm bundle user-upsert` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "user-upsert", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("user-upsert"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
