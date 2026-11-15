import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsSystem, validateResponse } from "../../core/src/index";
import { handle, impl, spokenBrief } from "../src/approver-brief";
import { handle as request } from "../src/discount-request";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const ESPRESSO = "120d56dc-215d-557d-bbab-43d87e1047c4";

async function setup() {
  const t = kit();
  const r = ok(await request(t.fnCtx("nikos", { account_id: IDS.miltos, discount_pct: 8, lines: [{ product_id: ESPRESSO, quantity: 20 }], justification: "Competitor offers 10%", mode: "async" })));
  return { t, r };
}

describe("fn:approver-brief (REQ-DSC-003)", () => {
  it("one spoken sentence from rows, in the callee's language, plus limits and lines", async () => {
    const { t, r } = await setup();
    const b = ok(await handle(t.fnCtx("eleni", { approval_id: r.approval_id })));
    expect(validateResponse("approver-brief", b).ok).toBe(true);
    expect(b).toMatchObject({ requested_pct: 8, policy_limit_pct: 3, approver_limit_pct: 10, callee: { id: IDS.eleni }, requester: { id: IDS.nikos }, account: { id: IDS.miltos, name: "Café Miltos" }, lines: [{ name: "Espresso Classico 1kg", quantity: 20, unit: "kg" }] });
    expect(b.spoken_brief).toBe("Nikos Alexiou ζητά έκπτωση 8% για Café Miltos σε 20 κιλά Espresso Classico 1kg, ενώ το όριό του είναι 3%.");
    expect(b.spoken_brief.split(/[.!?](\s|$)/).filter((s) => s.trim()).length).toBe(1);
    expect(b.context_facts).toContain("Justification: Competitor offers 10%");
  });

  it("English brief", () => {
    expect(spokenBrief("en", { requester: "Nikos Alexiou", account: "Café Miltos", requested: 8, limit: 3, lines: [{ name: "Espresso Classico 1kg", quantity: 20, unit: "kg" }] }))
      .toBe("Nikos Alexiou asks for 8% off for Café Miltos on 20 kg Espresso Classico 1kg, above their limit of 3%.");
  });

  it("scope: another rep is forbidden; merc-approver (system principal) can read it", async () => {
    const { t, r } = await setup();
    expect(errCode(await handle(t.fnCtx("dimitra", { approval_id: r.approval_id })))).toBe("forbidden");
    const sys = ok(await runAsSystem("approver-brief", impl, { tables: t.tables, data: { approval_id: r.approval_id }, orgId: IDS.org, caller: "procedure" }));
    expect(sys.requested_pct).toBe(8);
    expect(errCode(await handle(t.fnCtx("eleni", { approval_id: IDS.org })))).toBe("not_found");
  });

  it("functions/approver-brief/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "approver-brief", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("approver-brief"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
