import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, makeImpl } from "../src/approval-resolve";
import { kit, ok, errCode, IDS, type Kit } from "../src/_lib/testkit";
import { draftMessage } from "../src/draft-message";
const DRAFT = { subject: "Samples on Thursday", body: "Hi Miltos, as promised I will bring the samples on Thursday. Nikos" };
const fakeModel = (out: unknown = DRAFT) => () => ({ withStructuredOutput: () => ({ invoke: async () => out }) });
async function seedDraft(t: Kit, who: "nikos" | "dimitra" = "nikos", account = IDS.miltos) {
  const me = await t.principal(who);
  return draftMessage(t.db, me, { account_id: account, intent: "confirm samples Thursday", channel: "email", on_behalf_of: me.id }, { model: fakeModel() as never });
}

function gmail(result: unknown = { id: "gmail-msg-1" }, fail: Error | null = null) {
  const calls: any[] = [];
  return { calls, call: async (conn: string, action: string, args: any) => { calls.push({ conn, action, args }); if (fail) throw fail; return result; } };
}

describe("fn:approval-resolve (REQ-APR-001, REQ-APR-002, REQ-DEB-005)", () => {
  it("'yes send it': approve sends once via the per-user Gmail connection; approving twice sends exactly one email", async () => {
    const t = kit({ globals: { MERC_GMAIL_CONNECTION: "merc-gmail" } });
    const { approval_id } = await seedDraft(t);
    const g = gmail();
    const ctx = { ...t.fnCtx("nikos", { approval_id, decision: "approve" }), integrations: g };
    const r = ok(await handle(ctx as never));
    expect(validateResponse("approval-resolve", r).ok).toBe(true);
    expect(r.approval.status).toBe("sent");
    expect(g.calls).toEqual([{ conn: "merc-gmail", action: "google_workspace_gmail_message_send", args: { to: ["miltos@miltos.example.gr"], subject: DRAFT.subject, body: DRAFT.body } }]);
    const again = ok(await handle({ ...t.fnCtx("nikos", { approval_id, decision: "approve" }), integrations: g } as never));
    expect(again.approval.status).toBe("sent");
    expect(g.calls.length).toBe(1);
    const m = (await t.db.message_approval.findOne({ approval_id }))!;
    expect(m).toMatchObject({ external_message_id: "gmail-msg-1" });
    expect(m.sent_at).toBeTruthy();
    const a = (await t.db.approval.get(approval_id))!;
    expect(a).toMatchObject({ status: "sent", decided_by: IDS.nikos, decided_via: "app" });
    expect((await t.db.ai_action.get(a.ai_action_id!))!.status).toBe("applied");
    expect((await t.db.activity.all({ account_id: IDS.miltos, activity_type: "email", source: "ai" })).length).toBe(1);
    expect((await t.db.usage_event.all({ user_id: IDS.nikos, kind: "emails_sent" })).length).toBe(1);
  });

  it("'change Thursday to Friday': edit_approve sends the edited body; empty final_body -> validation_failed", async () => {
    const t = kit();
    const { approval_id } = await seedDraft(t);
    const g = gmail();
    expect(errCode(await handle({ ...t.fnCtx("nikos", { approval_id, decision: "edit_approve", final_body: "  " }), integrations: g } as never))).toBe("validation_failed");
    const edited = DRAFT.body.replace("Thursday", "Friday");
    const r = ok(await handle({ ...t.fnCtx("nikos", { approval_id, decision: "edit_approve", final_body: edited }), integrations: g } as never));
    expect(r.approval).toMatchObject({ status: "sent", body: edited });
    expect(g.calls[0].args.body).toBe(edited);
  });

  it("send failure -> status failed with the reason; approving again retries and sends", async () => {
    const t = kit();
    const { approval_id } = await seedDraft(t);
    const bad = gmail(null, new Error("execute action: this integration needs you to connect your own account before it can act for you"));
    const r = ok(await handle({ ...t.fnCtx("nikos", { approval_id, decision: "approve" }), integrations: bad } as never));
    expect(r.approval.status).toBe("failed");
    expect((await t.db.message_approval.findOne({ approval_id }))!.failure_reason).toMatch(/not connected their Gmail/);
    const g = gmail({ result: { id: "gmail-2" } });
    expect(ok(await handle({ ...t.fnCtx("nikos", { approval_id, decision: "approve" }), integrations: g } as never)).approval.status).toBe("sent");
    expect((await t.db.message_approval.findOne({ approval_id }))!).toMatchObject({ external_message_id: "gmail-2", failure_reason: null });
  });

  it("no context.integrations -> failed naming the blocker (degrades, never throws)", async () => {
    const t = kit();
    const { approval_id } = await seedDraft(t);
    const r = ok(await handle(t.fnCtx("nikos", { approval_id, decision: "approve" })));
    expect(r.approval.status).toBe("failed");
    expect((await t.db.message_approval.findOne({ approval_id }))!.failure_reason).toMatch(/integrations is not available/);
  });

  it("reject: no send, ai_action rejected; then approve is a conflict", async () => {
    const t = kit();
    const { approval_id, ai_action_id } = await seedDraft(t);
    const g = gmail();
    expect(ok(await handle({ ...t.fnCtx("nikos", { approval_id, decision: "reject" }), integrations: g } as never)).approval.status).toBe("rejected");
    expect((await t.db.ai_action.get(ai_action_id))!.status).toBe("rejected");
    expect(errCode(await handle({ ...t.fnCtx("nikos", { approval_id, decision: "approve" }), integrations: g } as never))).toBe("conflict");
    expect(g.calls.length).toBe(0);
  });

  it("scope: another rep -> forbidden; the manager cannot send from the rep's mailbox; spoofed caller ignored", async () => {
    const t = kit();
    const { approval_id } = await seedDraft(t);
    const g = gmail();
    expect(errCode(await handle({ ...t.fnCtx("dimitra", { approval_id, decision: "approve" }), integrations: g } as never))).toBe("forbidden");
    expect(errCode(await handle({ ...t.fnCtx("dimitra", { approval_id, decision: "approve", caller: { user_id: IDS.nikos } }), integrations: g } as never))).toBe("forbidden");
    expect(errCode(await handle({ ...t.fnCtx("thanasis", { approval_id, decision: "approve" }), integrations: g } as never))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx(null, { approval_id, decision: "approve" })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { approval_id: IDS.miltos, decision: "approve" })))).toBe("not_found");
    expect(g.calls.length).toBe(0);
  });

  it("buddy tool path: same impl, decided_via voice_buddy, pushes approval.decided when a service account exists", async () => {
    const t = kit();
    const { approval_id } = await seedDraft(t);
    const g = gmail();
    const posts: any[] = [];
    const api = { post: async (path: string, o: any) => { posts.push({ path, o }); return {}; } };
    const r = ok(await runAsTool("approval-resolve", makeImpl({ integrations: g, api, via: "voice_buddy" }), t.toolCtx("nikos"), { approval_id, decision: "approve" }, t.key));
    expect(r.approval.status).toBe("sent");
    expect((await t.db.approval.get(approval_id))!.decided_via).toBe("voice_buddy");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ path: "/v1/function-sockets/messages", o: { body: { channel: `rep:${IDS.nikos}`, data: { type: "approval.decided" } } } });
  });

  it("discount approvals are not resolved here", async () => {
    const t = kit();
    const a = await t.db.approval.insert({ kind: "discount", requested_by: IDS.nikos, approver_id: IDS.nikos, mode: "async", status: "pending" } as never);
    expect(errCode(await handle(t.fnCtx("nikos", { approval_id: a.id, decision: "approve" })))).toBe("validation_failed");
  });

  it("functions/approval-resolve/handler.gen.js is the current bundle (run `pnpm bundle approval-resolve` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "approval-resolve", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("approval-resolve"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
