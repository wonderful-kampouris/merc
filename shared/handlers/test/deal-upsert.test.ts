import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl, parseDealFields } from "../src/deal-upsert";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const DEAL = "50bce864-2842-50e6-8615-503cf2fe5c6f"; // Espresso 20kg monthly, Café Miltos, nikos, negotiation

describe("fn:deal-upsert", () => {
  it("creates a deal owned by the rep with a first stage-history row", async () => {
    const t = kit();
    const body = { account_id: IDS.miltos, fields: { title: "Syrups trial", amount_minor: 50000, expected_close_date: "2026-12-01" } };
    expect(validateRequest("deal-upsert", body).ok).toBe(true);
    const r = ok(await handle(t.fnCtx("nikos", body)));
    expect(validateResponse("deal-upsert", r).ok).toBe(true);
    const d = await t.db.deal.require(r.deal_id);
    expect(d).toMatchObject({ owner_id: IDS.nikos, stage_code: "new", title: "Syrups trial", amount_minor: 50000, closed_at: null });
    const h = await t.db.deal_stage_history.all({ deal_id: d.id });
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ from_stage_code: null, to_stage_code: "new", changed_by: IDS.nikos });
  });

  it("moving the stage writes history and sets/clears closed_at", async () => {
    const t = kit();
    ok(await handle(t.fnCtx("eleni", { deal_id: DEAL, account_id: IDS.miltos, fields: { stage_code: "won" } })));
    let d = await t.db.deal.require(DEAL);
    expect(d.stage_code).toBe("won");
    expect(d.closed_at).toBeTruthy();
    ok(await handle(t.fnCtx("nikos", { deal_id: DEAL, account_id: IDS.miltos, fields: { stage_code: "negotiation", next_step: " call Friday " } })));
    d = await t.db.deal.require(DEAL);
    expect(d).toMatchObject({ stage_code: "negotiation", closed_at: null, next_step: "call Friday" });
    const h = await t.db.deal_stage_history.all({ deal_id: DEAL });
    expect(h.map((x) => `${x.from_stage_code}>${x.to_stage_code}`).sort()).toEqual(["negotiation>won", "won>negotiation"]);
    // patch without a stage change: no extra history
    ok(await handle(t.fnCtx("nikos", { deal_id: DEAL, account_id: IDS.miltos, fields: { amount_minor: 1 } })));
    expect(await t.db.deal_stage_history.count({ deal_id: DEAL })).toBe(2);
  });

  it("rejects unknown fields, bad values, unknown stages and a deal of another account", async () => {
    const t = kit();
    expect(() => parseDealFields({ probability: 1 })).toThrow(/unknown field/);
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, fields: { title: "x", amount_minor: 1.5 } })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, fields: { title: "x", stage_code: "maybe" } })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, fields: {} })))).toBe("validation_failed");
    const lofos = "24d14591-c8c2-5885-819a-c5e997f6cad0";
    expect(errCode(await handle(t.fnCtx("nikos", { deal_id: DEAL, account_id: lofos, fields: { title: "x" } })))).toBe("validation_failed");
  });

  it("scope: an out-of-scope account is forbidden; a rep cannot hand a deal to someone else", async () => {
    const t = kit();
    const center = (await t.db.account.all({ territory_id: IDS.center }))[0]!;
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: center.id, fields: { title: "x" } })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, fields: { title: "x", owner_id: IDS.dimitra } })))).toBe("forbidden");
    // a manager may assign to a team member; a new deal by a manager defaults to the account owner
    const r = ok(await handle(t.fnCtx("eleni", { account_id: IDS.miltos, fields: { title: "Team deal" } })));
    expect((await t.db.deal.require(r.deal_id)).owner_id).toBe(IDS.nikos);
    ok(await handle(t.fnCtx("eleni", { deal_id: r.deal_id, account_id: IDS.miltos, fields: { owner_id: IDS.dimitra } })));
    expect((await t.db.deal.require(r.deal_id)).owner_id).toBe(IDS.dimitra);
  });

  it("a spoofed caller is ignored and the tool path matches", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", { account_id: IDS.miltos, fields: { title: "Spoof" }, caller: { user_id: IDS.thanasis } })));
    expect((await t.db.deal.require(r.deal_id)).owner_id).toBe(IDS.nikos);
    const v = ok(await runAsTool("deal-upsert", impl, t.toolCtx("nikos"), { account_id: IDS.miltos, fields: { title: "Via tool" } }, t.key));
    expect((await t.db.deal.require(v.deal_id)).owner_id).toBe(IDS.nikos);
  });

  it("functions/deal-upsert/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "deal-upsert", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("deal-upsert"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
