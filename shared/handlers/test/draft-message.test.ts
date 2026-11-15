import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, makeImpl } from "../src/draft-message";
import { runAsSystem } from "../../core/src/index";
import { kit, ok, errCode, IDS, type Kit } from "../src/_lib/testkit";
import { draftMessage } from "../src/draft-message";
const DRAFT = { subject: "Samples on Thursday", body: "Hi Miltos, as promised I will bring the samples on Thursday. Nikos" };
const fakeModel = (out: unknown = DRAFT) => () => ({ withStructuredOutput: () => ({ invoke: async () => out }) });
async function seedDraft(t: Kit, who: "nikos" | "dimitra" = "nikos", account = IDS.miltos) {
  const me = await t.principal(who);
  return draftMessage(t.db, me, { account_id: account, intent: "confirm samples Thursday", channel: "email", on_behalf_of: me.id }, { model: fakeModel() as never });
}

describe("fn:draft-message (REQ-DEB-005, REQ-APR-001)", () => {
  it("drafts in the rep's identity as a pending customer_message approval and never sends", async () => {
    const t = kit();
    const nikos = await t.principal("nikos");
    const r = await seedDraft(t);
    expect(validateResponse("draft-message", r).ok).toBe(true);
    const a = (await t.db.approval.get(r.approval_id))!;
    expect(a).toMatchObject({ kind: "customer_message", status: "pending", requested_by: IDS.nikos, approver_id: IDS.nikos, mode: "async", ai_action_id: r.ai_action_id });
    expect(Date.parse(a.expires_at!) - Date.now()).toBeGreaterThan(47 * 3600e3);
    const m = (await t.db.message_approval.findOne({ approval_id: a.id }))!;
    expect(m).toMatchObject({ channel_code: "email", recipient_address: "miltos@miltos.example.gr", subject: DRAFT.subject, draft_body: DRAFT.body });
    expect(m.sent_at ?? null).toBeNull();
    const act = (await t.db.ai_action.get(r.ai_action_id))!;
    expect(act).toMatchObject({ status: "suggested", action_type_code: "send_email", on_behalf_of: nikos.id, target_table: "message_approval", target_id: m.id });
  });

  it("passes rep style samples and only request facts to the LLM", async () => {
    const t = kit();
    await t.db.activity.insert({ account_id: IDS.miltos, actor_user_id: IDS.nikos, activity_type: "email", source: "human", body: "Geia sas! Nikos", occurred_at: "2026-11-10T09:00:00Z" } as never);
    let seen: any = null;
    const model = () => ({ withStructuredOutput: () => ({ invoke: async (msgs: any[]) => { seen = JSON.parse(msgs[1].content); return DRAFT; } }) });
    const me = await t.principal("nikos");
    await draftMessage(t.db, me, { account_id: IDS.miltos, intent: "thank you", channel: "email", context: "ordered 12 kg", on_behalf_of: me.id }, { model: model as never });
    expect(seen.rep_style_samples).toEqual(["Geia sas! Nikos"]);
    expect(seen.facts).toEqual([{ label: "intent", value: "thank you" }, { label: "context", value: "ordered 12 kg" }]);
    expect(seen.rep_name).toBe(me.user.full_name);
  });

  it("LLM output breaking the schema -> error, nothing written", async () => {
    const t = kit();
    const me = await t.principal("nikos");
    const before = (await t.db.approval.all()).length;
    await expect(draftMessage(t.db, me, { account_id: IDS.miltos, intent: "x", channel: "email", on_behalf_of: me.id }, { model: fakeModel({ nope: 1 }) as never })).rejects.toMatchObject({ code: "validation_failed" });
    expect((await t.db.approval.all()).length).toBe(before);
  });

  it("scope: another rep's account or on_behalf_of someone else -> forbidden; manager may draft for the team; system may draft", async () => {
    const t = kit();
    const dimitra = await t.principal("dimitra");
    await expect(draftMessage(t.db, dimitra, { account_id: IDS.miltos, intent: "x", channel: "email", on_behalf_of: IDS.nikos }, { model: fakeModel() as never })).rejects.toMatchObject({ code: "forbidden" });
    const eleni = await t.principal("eleni");
    expect((await draftMessage(t.db, eleni, { account_id: IDS.miltos, intent: "x", channel: "email", on_behalf_of: IDS.nikos }, { model: fakeModel() as never })).approval_id).toBeTruthy();
    const sys = ok(await runAsSystem("draft-message", makeImpl({ model: fakeModel() as never }), { tables: t.tables, orgId: IDS.org, caller: "procedure", data: { account_id: IDS.miltos, intent: "x", channel: "email", on_behalf_of: IDS.nikos } }));
    expect((await t.db.approval.get(sys.approval_id))!.requested_by).toBe(IDS.nikos);
  });

  it("ai_permission never -> blocked_by_policy; no address on whatsapp -> validation_failed", async () => {
    const t = kit();
    const me = await t.principal("nikos");
    const p = (await t.db.ai_permission.findOne({ role_code: "rep", action_type_code: "send_email" }))!;
    await t.db.ai_permission.update(p.id, { mode: "never" });
    await expect(draftMessage(t.db, me, { account_id: IDS.miltos, intent: "x", channel: "email", on_behalf_of: me.id }, { model: fakeModel() as never })).rejects.toMatchObject({ code: "blocked_by_policy" });
    expect(errCode(await handle(t.fnCtx(null, { account_id: IDS.miltos, intent: "x", channel: "email", on_behalf_of: IDS.nikos })))).toBe("forbidden");
  });

  it("contract: request validates; the Function entry without an LLM runtime answers a stable error", async () => {
    const t = kit();
    const body = { account_id: IDS.miltos, intent: "x", channel: "email", on_behalf_of: IDS.nikos, caller: { user_id: IDS.thanasis } };
    expect(validateRequest("draft-message", { ...body, caller: undefined }).ok).toBe(true);
    const out: any = await handle(t.fnCtx("nikos", body));
    expect(out.error.code).toBe("upstream_failed");
    expect(out.error.message).toMatch(/ModelProfiles/);
  });

  it("functions/draft-message/handler.gen.js is the current bundle (run `pnpm bundle draft-message` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "draft-message", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("draft-message"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
