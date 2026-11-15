import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS, DEMO_DAY } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

import { handle, impl, makeImpl } from "../src/account-convert";
import { decode } from "../../autonomy/src/snapshot";
import { validateEvent } from "../../live/src/index";
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${DEMO_DAY}T08:00:00Z`)); });
afterEach(() => { vi.useRealTimers(); });
const AVRA = "ef86a932-3241-51c8-b7be-1df72dbf74f9";
const idOf = async (t: ReturnType<typeof kit>, name: string) => (await t.db.account.findOne({ name }))!.id;

describe("fn:account-convert (REQ-APR-004)", () => {
  it("converting Café Avra creates a pending conversion approval for the manager (seed: ask)", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { account_id: AVRA })));
    expect(validateResponse("account-convert", r).ok).toBe(true);
    expect(r.status).toBe("pending");
    const ap = (await t.db.approval.get(r.approval_id))!;
    expect(ap).toMatchObject({ kind: "conversion", status: "pending", requested_by: IDS.nikos, approver_id: IDS.eleni, mode: "async" });
    const action = (await t.db.ai_action.get(ap.ai_action_id!))!;
    expect(action).toMatchObject({ action_type_code: "convert_prospect", status: "suggested", target_table: "account", target_id: AVRA, on_behalf_of: IDS.nikos, org_id: IDS.org });
    expect(JSON.parse(action.payload_json!)).toEqual({ table: "account", id: AVRA, patch: { account_type: "customer", customer_since: DEMO_DAY } });
    expect(decode(action.before_snapshot_json)!.rows[0]).toMatchObject({ table: "account", id: AVRA, row: { account_type: "prospect" } });
    expect((await t.db.account.get(AVRA))!.account_type).toBe("prospect"); // nothing applied before approval
  });

  it("is idempotent while pending, and refuses non-prospects", async () => {
    const t = kit();
    const a = ok(await handle(t.fnCtx("nikos", { account_id: AVRA })));
    const b = ok(await handle(t.fnCtx("nikos", { account_id: AVRA })));
    expect(b).toEqual(a);
    expect((await t.db.approval.all({ kind: "conversion" })).length).toBe(1);
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: IDS.miltos })))).toBe("validation_failed");
  });

  it("ai_permission auto applies at once with snapshots; never is blocked_by_policy", async () => {
    const t = kit();
    const perm = (await t.db.ai_permission.findOne({ role_code: "rep", action_type_code: "convert_prospect" }))!;
    await t.db.ai_permission.update(perm.id, { mode: "auto" });
    const r = ok(await handle(t.fnCtx("nikos", { account_id: AVRA })));
    expect(r.status).toBe("approved");
    expect((await t.db.account.get(AVRA))!).toMatchObject({ account_type: "customer", customer_since: DEMO_DAY });
    const ap = (await t.db.approval.get(r.approval_id))!;
    const action = (await t.db.ai_action.get(ap.ai_action_id!))!;
    expect(action.status).toBe("applied");
    expect(decode(action.after_snapshot_json)!.rows[0]!.row).toMatchObject({ account_type: "customer" });

    await t.db.ai_permission.update(perm.id, { mode: "never" });
    const nisi = await idOf(t, "Nisi Café");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: nisi })))).toBe("blocked_by_policy");
  });

  it("pushes approval.created to the approver when a service account exists; degrades silently without one", async () => {
    const t = kit();
    const posts: any[] = [];
    const api = { post: async (path: string, o: any) => { posts.push({ path, ...o }); return {}; } };
    const r = ok(await makeImpl({ api })({ req: { account_id: AVRA }, db: t.db, me: await t.principal("nikos"), platform: {} }));
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe("/v1/function-sockets/messages");
    expect(posts[0].body.channel).toBe(`rep:${IDS.eleni}`);
    expect(posts[0].body.data.payload.approval).toMatchObject({ approval_id: r.approval_id, kind: "conversion", status: "pending", account: { id: AVRA, name: "Café Avra" } });
    expect(validateEvent(posts[0].body.data).ok).toBe(true);
    // the deployed entry with context.api passes it through
    const t2 = kit();
    const posts2: any[] = [];
    const ctx: any = { ...t2.fnCtx("nikos", { account_id: AVRA }), api: { post: async (_p: string, o: any) => { posts2.push(o); return {}; } } };
    ok(await handle(ctx));
    expect(posts2).toHaveLength(1);
  });

  it("scope and identity: another territory forbidden (app and voice), spoofed caller ignored, no user forbidden", async () => {
    const t = kit();
    const anemos = await idOf(t, "Anemos Deli"); // Center prospect
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: anemos })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: anemos, caller: { user_id: IDS.thanasis, role: "admin" } })))).toBe("forbidden");
    expect(errCode(await runAsTool("account-convert", impl, t.toolCtx("nikos"), { account_id: anemos }, t.key))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx(null, { account_id: AVRA })))).toBe("forbidden");
    const viaTool = ok(await runAsTool("account-convert", impl, t.toolCtx("nikos"), { account_id: AVRA }, t.key));
    expect(viaTool.status).toBe("pending");
  });

  it("functions/account-convert/handler.gen.js is the current bundle (run `pnpm bundle account-convert` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "account-convert", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("account-convert"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
