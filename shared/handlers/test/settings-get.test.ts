import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl } from "../src/settings-get";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const audits = (t: ReturnType<typeof kit>) => t.db.audit_event.all();

describe("fn:settings-get (REQ-SET-001)", () => {
  it("returns org, AI permissions, alert rules, ICP and discount policies from the seed", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("thanasis")));
    expect(validateResponse("settings-get", r).ok).toBe(true);
    expect((r.organization as any).id).toBe(IDS.org);
    expect(r.ai_permissions.length).toBe(72);
    expect(r.ai_permissions.find((p: any) => p.role_code === "rep" && p.action_type_code === "send_email")).toBeTruthy();
    expect(r.alert_rules.length).toBe(8);
    expect((r.icp as any).criteria.length).toBe(5);
    expect((r.icp as any).categories.length).toBe(2);
    expect((r.icp as any).categories[0].name).toEqual(expect.any(String));
    expect(r.discount_policies.length).toBe(4);
  });

  it("managers can read (settings.read); reps are forbidden; no user is forbidden", async () => {
    const t = kit();
    ok(await handle(t.fnCtx("eleni")));
    expect(errCode(await handle(t.fnCtx("nikos")))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx(null)))).toBe("forbidden");
  });

  it("ignores a spoofed caller; the tool path gives the same result", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", { caller: { user_id: IDS.thanasis } })))).not.toBe(null);
    expect(ok(await runAsTool("settings-get", impl, t.toolCtx("thanasis"), {}, t.key))).toEqual(ok(await handle(t.fnCtx("thanasis"))));
    expect(await audits(t)).toHaveLength(0);
  });

  it("functions/settings-get/handler.gen.js is the current bundle (run `pnpm bundle settings-get` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "settings-get", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("settings-get"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
