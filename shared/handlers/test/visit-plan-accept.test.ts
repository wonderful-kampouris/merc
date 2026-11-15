import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsTool, validateResponse } from "../../core/src/index";
import { makeImpl } from "../src/visit-plan-accept";
import { kit, ok, errCode, IDS, type Kit } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const NOW = Date.parse("2026-11-22T16:30:00Z");
const impl = makeImpl({ now: () => NOW });
const handle = defineFunction("visit-plan-accept", impl);
const proposed = async (t: Kit, rep = IDS.nikos) => (await t.db.visit_plan.insert({ rep_id: rep, week_start: "2026-11-23", status: "proposed", accepted_at: null } as any)).id;

describe("fn:visit-plan-accept (REQ-PLN-002)", () => {
  it("'Accept my week' sets the plan to accepted with accepted_at", async () => {
    const t = kit();
    const id = await proposed(t);
    const r = ok(await handle(t.fnCtx("nikos", { plan_id: id })));
    expect(r).toEqual({ plan_id: id, status: "accepted" });
    expect(validateResponse("visit-plan-accept", r).ok).toBe(true);
    const row = await t.db.visit_plan.require(id);
    expect(row.status).toBe("accepted");
    expect(row.accepted_at).toBe(new Date(NOW).toISOString());
  });

  it("by voice: the buddy tool accepts the same way", async () => {
    const t = kit();
    const id = await proposed(t);
    expect(ok(await runAsTool("visit-plan-accept", impl, t.toolCtx("nikos"), { plan_id: id }, t.key)).status).toBe("accepted");
  });

  it("accepting twice keeps the first accepted_at", async () => {
    const t = kit();
    const id = await proposed(t);
    ok(await handle(t.fnCtx("nikos", { plan_id: id })));
    const later = defineFunction("visit-plan-accept", makeImpl({ now: () => NOW + 3_600_000 }));
    ok(await later(t.fnCtx("nikos", { plan_id: id })));
    expect((await t.db.visit_plan.require(id)).accepted_at).toBe(new Date(NOW).toISOString());
  });

  it("scope owner: another rep and the manager are forbidden; unknown plan not_found", async () => {
    const t = kit();
    const id = await proposed(t);
    expect(errCode(await handle(t.fnCtx("dimitra", { plan_id: id })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("eleni", { plan_id: id })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { plan_id: "00000000-0000-4000-8000-000000000000" })))).toBe("not_found");
    expect(errCode(await handle(t.fnCtx("nikos", {})))).toBe("validation_failed");
    expect((await t.db.visit_plan.require(id)).status).toBe("proposed");
  });

  it("ignores a spoofed caller in the body", async () => {
    const t = kit();
    const id = await proposed(t);
    expect(errCode(await handle(t.fnCtx("dimitra", { plan_id: id, caller: { user_id: IDS.nikos } })))).toBe("forbidden");
  });

  it("functions/visit-plan-accept/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "visit-plan-accept", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("visit-plan-accept"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
