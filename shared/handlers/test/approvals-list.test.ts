import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, impl } from "../src/approvals-list";
import { kit, ok, errCode, IDS, type Kit } from "../src/_lib/testkit";
import { draftMessage } from "../src/draft-message";
const DRAFT = { subject: "Samples on Thursday", body: "Hi Miltos, as promised I will bring the samples on Thursday. Nikos" };
const fakeModel = (out: unknown = DRAFT) => () => ({ withStructuredOutput: () => ({ invoke: async () => out }) });
async function seedDraft(t: Kit, who: "nikos" | "dimitra" = "nikos", account = IDS.miltos) {
  const me = await t.principal(who);
  return draftMessage(t.db, me, { account_id: account, intent: "confirm samples Thursday", channel: "email", on_behalf_of: me.id }, { model: fakeModel() as never });
}

describe("fn:approvals-list (REQ-APR-001)", () => {
  it("the rep sees their pending customer message with a preview; filters by kind/status/role", async () => {
    const t = kit();
    const { approval_id } = await seedDraft(t);
    await t.db.approval.insert({ kind: "discount", requested_by: IDS.dimitra, approver_id: IDS.eleni, mode: "async", status: "pending" } as never);
    const r = ok(await handle(t.fnCtx("nikos")));
    expect(validateResponse("approvals-list", r).ok).toBe(true);
    expect(r.items.map((i) => i.approval_id)).toEqual([approval_id]);
    expect(r.items[0]).toMatchObject({ kind: "customer_message", status: "pending", channel: "email", recipient: "miltos@miltos.example.gr", subject: DRAFT.subject, body: DRAFT.body, account: { id: IDS.miltos } });
    expect(r.items[0]!.preview).toMatch(/^To miltos@miltos.example.gr: Samples on Thursday/);
    expect(ok(await handle(t.fnCtx("nikos", { kind: "discount" }))).items).toEqual([]);
    expect(ok(await handle(t.fnCtx("nikos", { status: "sent" }))).items).toEqual([]);
    expect(ok(await handle(t.fnCtx("nikos", { role: "requester" }))).items).toHaveLength(1);
  });

  it("scope: another rep sees nothing; the approver manager sees the discount; admin sees all of the org", async () => {
    const t = kit();
    await seedDraft(t);
    await t.db.approval.insert({ kind: "discount", requested_by: IDS.dimitra, approver_id: IDS.eleni, mode: "async", status: "pending" } as never);
    expect(ok(await handle(t.fnCtx("dimitra", { kind: "customer_message" }))).items).toEqual([]);
    const el = ok(await handle(t.fnCtx("eleni", { role: "approver" })));
    expect(el.items.map((i) => i.kind)).toEqual(["discount"]);
    expect(el.items[0]!.preview).toMatch(/% discount/);
    expect(ok(await handle(t.fnCtx("thanasis"))).items).toHaveLength(2);
    expect(errCode(await handle(t.fnCtx(null)))).toBe("forbidden");
  });

  it("spoofed caller ignored; GET params validated; tool path equals the function", async () => {
    const t = kit();
    await seedDraft(t);
    expect(errCode(await handle(t.fnCtx("nikos", { role: "boss" })))).toBe("validation_failed");
    const fn = ok(await handle(t.fnCtx("dimitra", { caller: { user_id: IDS.nikos } })));
    expect(fn.items).toEqual([]);
    expect(await runAsTool("approvals-list", impl, t.toolCtx("nikos"), { kind: "customer_message" }, t.key)).toEqual(ok(await handle(t.fnCtx("nikos", { kind: "customer_message" }))));
    expect(validateRequest("approvals-list", { kind: null }).ok).toBe(true);
  });

  it("functions/approvals-list/handler.gen.js is the current bundle (run `pnpm bundle approvals-list` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "approvals-list", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("approvals-list"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
