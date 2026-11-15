import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, impl } from "../src/approval-status";
import { kit, ok, errCode, IDS, type Kit } from "../src/_lib/testkit";
import { draftMessage } from "../src/draft-message";
const DRAFT = { subject: "Samples on Thursday", body: "Hi Miltos, as promised I will bring the samples on Thursday. Nikos" };
const fakeModel = (out: unknown = DRAFT) => () => ({ withStructuredOutput: () => ({ invoke: async () => out }) });
async function seedDraft(t: Kit, who: "nikos" | "dimitra" = "nikos", account = IDS.miltos) {
  const me = await t.principal(who);
  return draftMessage(t.db, me, { account_id: account, intent: "confirm samples Thursday", channel: "email", on_behalf_of: me.id }, { model: fakeModel() as never });
}

describe("fn:approval-status (REQ-DSC-005 polling, REQ-APR-001)", () => {
  it("requester gets the card; other rep forbidden; unknown id not_found; tool path same", async () => {
    const t = kit();
    const { approval_id } = await seedDraft(t);
    const r = ok(await handle(t.fnCtx("nikos", { approval_id })));
    expect(validateResponse("approval-status", r).ok).toBe(true);
    expect(r.approval).toMatchObject({ approval_id, status: "pending", requested_by: { id: IDS.nikos } });
    expect(errCode(await handle(t.fnCtx("dimitra", { approval_id })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("dimitra", { approval_id, caller: { user_id: IDS.nikos } })))).toBe("forbidden");
    expect(ok(await handle(t.fnCtx("thanasis", { approval_id }))).approval.approval_id).toBe(approval_id);
    expect(errCode(await handle(t.fnCtx("nikos", { approval_id: IDS.miltos })))).toBe("not_found");
    expect(errCode(await handle(t.fnCtx("nikos", { approval_id: "nope" })))).toBe("validation_failed");
    expect(await runAsTool("approval-status", impl, t.toolCtx("nikos"), { approval_id }, t.key)).toEqual(r);
  });

  it("discount approval card carries the percentages for the approver", async () => {
    const t = kit();
    const a = await t.db.approval.insert({ kind: "discount", requested_by: IDS.nikos, approver_id: IDS.eleni, mode: "live", status: "countered" } as never);
    await t.db.discount_request.insert({ approval_id: a.id, account_id: IDS.miltos, requested_pct: 8, policy_limit_pct: 5, approved_pct: 6 } as never);
    const r = ok(await handle(t.fnCtx("eleni", { approval_id: a.id })));
    expect(r.approval).toMatchObject({ kind: "discount", status: "countered", requested_pct: 8, policy_limit_pct: 5, approved_pct: 6, account: { id: IDS.miltos } });
  });

  it("functions/approval-status/handler.gen.js is the current bundle (run `pnpm bundle approval-status` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "approval-status", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("approval-status"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
