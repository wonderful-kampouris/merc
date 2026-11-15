import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateResponse } from "../../core/src/index";
import { handle } from "../src/manager-approvals-list";
import { handle as request } from "../src/discount-request";
import { handle as decide } from "../src/approval-decide";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const ESPRESSO = "120d56dc-215d-557d-bbab-43d87e1047c4";

describe("fn:manager-approvals-list (REQ-DSC-009, REQ-DSC-006 inbox)", () => {
  it("Eleni's inbox shows the open requests as approval cards; filters by status; admin sees all", async () => {
    const t = kit();
    const mk = async (pct: number) => ok(await request(t.fnCtx("nikos", { account_id: IDS.miltos, discount_pct: pct, lines: [{ product_id: ESPRESSO, quantity: 10 }], mode: "async" })));
    const a = await mk(8), b = await mk(6), big = await mk(12); // 12% -> Thanasis
    const inbox = ok(await handle(t.fnCtx("eleni", {})));
    expect(validateResponse("manager-approvals-list", inbox).ok).toBe(true);
    expect(inbox.items.map((i) => i.approval_id).sort()).toEqual([a.approval_id, b.approval_id].sort());
    expect(inbox.items[0]).toMatchObject({ kind: "discount", status: "pending", mode: "async", requested_by: { id: IDS.nikos }, approver: { id: IDS.eleni }, account: { name: "Café Miltos" } });
    expect(inbox.items.find((i) => i.approval_id === a.approval_id)!.preview).toBe("Nikos Alexiou: 8% for Café Miltos (limit 3%)");
    ok(await decide(t.fnCtx("eleni", { approval_id: a.approval_id, decision: "approve", via: "app" })));
    expect(ok(await handle(t.fnCtx("eleni", {}))).items.map((i) => i.approval_id)).toEqual([b.approval_id]);
    expect(ok(await handle(t.fnCtx("eleni", { status: "approved" }))).items.map((i) => i.approval_id)).toEqual([a.approval_id]);
    expect(ok(await handle(t.fnCtx("eleni", { status: "all" }))).items).toHaveLength(2);
    expect(ok(await handle(t.fnCtx("thanasis", {}))).items.map((i) => i.approval_id).sort()).toEqual([b.approval_id, big.approval_id].sort());
  });

  it("reps are forbidden (gate discounts.approve); a bad status is validation_failed", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", {})))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("eleni", { status: "nope" })))).toBe("validation_failed");
  });

  it("functions/manager-approvals-list/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "manager-approvals-list", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("manager-approvals-list"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
