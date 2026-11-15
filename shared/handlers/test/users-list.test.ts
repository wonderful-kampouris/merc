import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl } from "../src/users-list";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const audits = (t: ReturnType<typeof kit>) => t.db.audit_event.all();

describe("fn:users-list (REQ-SET-002)", () => {
  it("lists every org user with role, manager and territories", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("thanasis")));
    expect(validateResponse("users-list", r).ok).toBe(true);
    expect(r.items.length).toBe(6);
    const nikos: any = r.items.find((u: any) => u.id === IDS.nikos);
    expect(nikos).toMatchObject({ role_code: "rep", manager_id: IDS.eleni, status: "active", invite_pending: false });
    expect(nikos.territory_ids).toContain(IDS.north);
  });
  it("only admins (users.manage)", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("eleni")))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { caller: { role: "admin" } })))).toBe("forbidden");
    expect(ok(await runAsTool("users-list", impl, t.toolCtx("thanasis"), {}, t.key)).items.length).toBe(6);
  });

  it("functions/users-list/handler.gen.js is the current bundle (run `pnpm bundle users-list` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "users-list", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("users-list"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
