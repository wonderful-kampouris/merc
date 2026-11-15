import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, makeImpl } from "../src/approvals-expire";
import { runAsSystem } from "../../core/src/index";
import { kit, ok, errCode, IDS, type Kit } from "../src/_lib/testkit";
import { draftMessage } from "../src/draft-message";
const DRAFT = { subject: "Samples on Thursday", body: "Hi Miltos, as promised I will bring the samples on Thursday. Nikos" };
const fakeModel = (out: unknown = DRAFT) => () => ({ withStructuredOutput: () => ({ invoke: async () => out }) });
async function seedDraft(t: Kit, who: "nikos" | "dimitra" = "nikos", account = IDS.miltos) {
  const me = await t.principal(who);
  return draftMessage(t.db, me, { account_id: account, intent: "confirm samples Thursday", channel: "email", on_behalf_of: me.id }, { model: fakeModel() as never });
}

describe("fn:approvals-expire (REQ-APR-003)", () => {
  it("the cron moves stale pending customer messages to expired; fresh ones and other kinds stay", async () => {
    const t = kit();
    const stale = await seedDraft(t);
    const fresh = await seedDraft(t);
    const disc = await t.db.approval.insert({ kind: "discount", requested_by: IDS.nikos, approver_id: IDS.eleni, mode: "async", status: "pending", expires_at: "2020-01-01T00:00:00Z" } as never);
    await t.db.approval.update(stale.approval_id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    const dry = ok(await runAsSystem("approvals-expire", makeImpl(), { tables: t.tables, orgId: IDS.org, data: { dry_run: true } }));
    expect(dry.details).toMatchObject({ expired: 1, dry_run: true });
    expect((await t.db.approval.get(stale.approval_id))!.status).toBe("pending");
    const out: any = await handle({ tables: t.tables, data: {}, metadata: {} } as never);
    expect(out).toMatchObject({ slug: "approvals-expire", failed: 0 });
    const r = out.runs[0].outcome;
    expect(validateResponse("approvals-expire", r).ok).toBe(true);
    expect(r).toMatchObject({ processed: 2, created: 0, details: { expired: 1, approval_ids: [stale.approval_id], expiry_hours: 48 } });
    expect((await t.db.approval.get(stale.approval_id))!).toMatchObject({ status: "expired", decision_note: "expired after 48 h without a decision" });
    expect((await t.db.approval.get(fresh.approval_id))!.status).toBe("pending");
    expect((await t.db.approval.get(disc.id))!.status).toBe("pending");
  });

  it("without expires_at, created_at + approval_expiry_hours decides", async () => {
    const t = kit();
    const a = await seedDraft(t);
    await t.db.approval.update(a.approval_id, { expires_at: null } as never);
    const later = Date.now() + 49 * 3600e3;
    const r = ok(await runAsSystem("approvals-expire", makeImpl({ now: () => later }), { tables: t.tables, orgId: IDS.org, data: {} }));
    expect(r.details).toMatchObject({ expired: 1 });
    expect(validateRequest("approvals-expire", { dry_run: null }).ok).toBe(true);
  });

  it("functions/approvals-expire/handler.gen.js is the current bundle (run `pnpm bundle approvals-expire` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "approvals-expire", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("approvals-expire"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
