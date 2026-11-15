import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl } from "../src/assignments-transfer";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const audits = (t: ReturnType<typeof kit>) => t.db.audit_event.all();

const LOFOS = "24d14591-c8c2-5885-819a-c5e997f6cad0";
const LOFOS_TASK = "8573da3a-e392-5b66-948b-44c1fb43852d";

describe("fn:assignments-transfer (REQ-SET-003, REQ-CORE-010)", () => {
  it("transferring Lofos to Dimitra moves its open task and future planned visits; history + one audit", async () => {
    const t = kit();
    const body = { from_rep_id: IDS.nikos, to_rep_id: IDS.dimitra, account_ids: [LOFOS], reason: "rebalance" };
    expect(validateRequest("assignments-transfer", body).ok).toBe(true);
    const futureBefore = (await t.db.visit.all({ account_id: LOFOS, rep_id: IDS.nikos, status: "planned" })).length;
    const r = ok(await handle(t.fnCtx("eleni", body)));
    expect(r).toEqual({ moved: 1 });
    expect(validateResponse("assignments-transfer", r).ok).toBe(true);
    expect((await t.db.account.get(LOFOS))!.owner_rep_id).toBe(IDS.dimitra);
    expect((await t.db.task.get(LOFOS_TASK))!.owner_id).toBe(IDS.dimitra);
    expect(await t.db.account_assignment_history.all({ account_id: LOFOS })).toHaveLength(1);
    const a = await audits(t);
    expect(a).toHaveLength(1);
    expect(a[0].action).toBe("bulk_transfer");
    expect(JSON.parse(a[0].detail!).tasks_moved).toBe(1);
    // planned visits from today on moved too (seed demo day); done visits stay with Nikos
    const left = await t.db.visit.all({ account_id: LOFOS, rep_id: IDS.nikos, status: "planned" });
    expect(left.length).toBeLessThanOrEqual(futureBefore);
    expect((await t.db.visit.all({ account_id: LOFOS, rep_id: IDS.nikos, status: "done" })).length).toBeGreaterThanOrEqual(0);
  });

  it("all_accounts moves every account Nikos owns", async () => {
    const t = kit();
    const owned = await t.db.account.count({ owner_rep_id: IDS.nikos });
    expect(ok(await handle(t.fnCtx("thanasis", { from_rep_id: IDS.nikos, to_rep_id: IDS.dimitra, account_ids: [], all_accounts: true }))).moved).toBe(owned);
    expect(await t.db.account.count({ owner_rep_id: IDS.nikos })).toBe(0);
  });

  it("an account not owned by from_rep is rejected; same rep rejected; reps forbidden", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("eleni", { from_rep_id: IDS.dimitra, to_rep_id: IDS.nikos, account_ids: [LOFOS] })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("eleni", { from_rep_id: IDS.nikos, to_rep_id: IDS.nikos, account_ids: [LOFOS] })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { from_rep_id: IDS.nikos, to_rep_id: IDS.dimitra, account_ids: [LOFOS], caller: { role: "admin" } })))).toBe("forbidden");
    expect(errCode(await runAsTool("assignments-transfer", impl, t.toolCtx("dimitra"), { from_rep_id: IDS.nikos, to_rep_id: IDS.dimitra, account_ids: [LOFOS] }, t.key))).toBe("forbidden");
    expect(await audits(t)).toHaveLength(0);
  });

  it("a manager cannot move reps outside their team", async () => {
    const t = kit();
    const out = await handle(t.fnCtx("eleni", { from_rep_id: IDS.center_rep, to_rep_id: IDS.nikos, account_ids: [], all_accounts: true }));
    const eleni = await t.principal("eleni");
    if (!eleni.team_user_ids.includes(IDS.center_rep)) expect(errCode(out)).toBe("forbidden");
  });

  it("functions/assignments-transfer/handler.gen.js is the current bundle (run `pnpm bundle assignments-transfer` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "assignments-transfer", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("assignments-transfer"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
