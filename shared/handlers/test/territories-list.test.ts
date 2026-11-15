import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl } from "../src/territories-list";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const audits = (t: ReturnType<typeof kit>) => t.db.audit_event.all();

describe("fn:territories-list (REQ-SET-003)", () => {
  it("lists territories with reps, postal codes and can_manage", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("eleni")));
    expect(validateResponse("territories-list", r).ok).toBe(true);
    expect(r.items.length).toBe(3);
    const north: any = r.items.find((x: any) => x.id === IDS.north);
    expect(north.reps.map((x: any) => x.id)).toEqual(expect.arrayContaining([IDS.nikos, IDS.dimitra]));
    expect(north.postal_codes).toContain("15231");
    expect(north.can_manage).toBe(true);
    const repView: any = ok(await handle(t.fnCtx("nikos"))).items.find((x: any) => x.id === IDS.north);
    expect(repView.can_manage).toBe(false);
    expect(ok(await handle(t.fnCtx("thanasis"))).items.every((x: any) => x.can_manage)).toBe(true);
  });
  it("no user -> forbidden; tool path same; spoofed caller ignored", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx(null)))).toBe("forbidden");
    expect(ok(await runAsTool("territories-list", impl, t.toolCtx("nikos"), {}, t.key))).toEqual(ok(await handle(t.fnCtx("nikos", { caller: { role: "admin" } }))));
  });

  it("functions/territories-list/handler.gen.js is the current bundle (run `pnpm bundle territories-list` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "territories-list", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("territories-list"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
