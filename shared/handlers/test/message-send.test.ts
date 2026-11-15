import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, makeImpl, messageIdOf, sendApproved } from "../src/message-send";
import { runAsSystem } from "../../core/src/index";
import { kit, ok, errCode, IDS, type Kit } from "../src/_lib/testkit";
import { draftMessage } from "../src/draft-message";
const DRAFT = { subject: "Samples on Thursday", body: "Hi Miltos, as promised I will bring the samples on Thursday. Nikos" };
const fakeModel = (out: unknown = DRAFT) => () => ({ withStructuredOutput: () => ({ invoke: async () => out }) });
async function seedDraft(t: Kit, who: "nikos" | "dimitra" = "nikos", account = IDS.miltos) {
  const me = await t.principal(who);
  return draftMessage(t.db, me, { account_id: account, intent: "confirm samples Thursday", channel: "email", on_behalf_of: me.id }, { model: fakeModel() as never });
}

async function approved(t: Kit) {
  const r = await seedDraft(t);
  await t.db.approval.update(r.approval_id, { status: "approved" });
  return r.approval_id;
}
const gmail = () => { const calls: any[] = []; return { calls, call: async (...a: any[]) => { calls.push(a); return { id: "m-1" }; } }; };

describe("fn:message-send (REQ-APR-002)", () => {
  it("sends an approved message once, idempotent on the approval", async () => {
    const t = kit();
    const id = await approved(t);
    const g = gmail();
    const r = ok(await handle({ ...t.fnCtx("nikos", { approval_id: id }), integrations: g } as never));
    expect(validateResponse("message-send", r).ok).toBe(true);
    expect(r).toEqual({ status: "sent", external_message_id: "m-1", failure_reason: null });
    expect(ok(await handle({ ...t.fnCtx("nikos", { approval_id: id }), integrations: g } as never))).toEqual(r);
    expect(g.calls.length).toBe(1);
  });

  it("a send already in flight -> conflict, no second provider call", async () => {
    const t = kit();
    const id = await approved(t);
    const m = (await t.db.message_approval.findOne({ approval_id: id }))!;
    await t.db.message_approval.update(m.id, { external_message_id: "claim:other" });
    const g = gmail();
    const me = await t.principal("nikos");
    await expect(sendApproved(t.db, me, t.platform, { integrations: g }, id)).rejects.toMatchObject({ code: "conflict" });
    expect(g.calls.length).toBe(0);
  });

  it("pending (not approved) -> conflict; system caller -> forbidden; other rep -> forbidden", async () => {
    const t = kit();
    const { approval_id } = await seedDraft(t);
    expect(errCode(await handle({ ...t.fnCtx("nikos", { approval_id }), integrations: gmail() } as never))).toBe("conflict");
    await t.db.approval.update(approval_id, { status: "approved" });
    expect(errCode(await runAsSystem("message-send", makeImpl({ integrations: gmail() }), { tables: t.tables, orgId: IDS.org, data: { approval_id } }))).toBe("forbidden");
    expect(errCode(await handle({ ...t.fnCtx("dimitra", { approval_id }), integrations: gmail() } as never))).toBe("forbidden");
    expect(errCode(await runAsTool("message-send", makeImpl({ integrations: gmail() }), t.toolCtx("dimitra"), { approval_id }, t.key))).toBe("forbidden");
  });

  it("non-email channel has no sender yet -> failed with reason", async () => {
    const t = kit();
    const id = await approved(t);
    const m = (await t.db.message_approval.findOne({ approval_id: id }))!;
    await t.db.message_approval.update(m.id, { channel_code: "whatsapp" });
    const r = ok(await handle({ ...t.fnCtx("nikos", { approval_id: id }), integrations: gmail() } as never));
    expect(r.status).toBe("failed");
    expect(r.failure_reason).toMatch(/no sender for channel whatsapp/);
  });

  it("messageIdOf reads the common provider shapes", () => {
    expect(messageIdOf({ id: "a" })).toBe("a");
    expect(messageIdOf({ result: { messageId: "b" } })).toBe("b");
    expect(messageIdOf({ data: { message: { id: "c" } } })).toBe("c");
    expect(messageIdOf("x")).toBeNull();
    expect(validateRequest("message-send", { approval_id: IDS.miltos }).ok).toBe(true);
  });

  it("functions/message-send/handler.gen.js is the current bundle (run `pnpm bundle message-send` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "message-send", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("message-send"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
