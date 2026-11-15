import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateRequest, validateResponse } from "../../core/src/index";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle } from "../src/campaign-funnel";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";

const CAMPAIGN = "006021ba-1b63-5646-9d18-85a40098c0c9"; // seed: @D-1 .. @D+6 = 2026-11-15 .. 2026-11-22
const NUOVO = "b28bc378-ec47-55d6-a414-b09ac0dacc3d";
type K = ReturnType<typeof kit>;
const expose = (t: K, stage: string, at: string, rep = IDS.nikos, account = IDS.miltos) =>
  t.db.campaign_exposure.insert({ campaign_id: CAMPAIGN, account_id: account, rep_id: rep, stage, occurred_at: at, ...(stage === "pitched" ? { evidence_quote: "I showed them the Nuovo blend" } : {}) } as never);
async function order(t: K, date: string, status = "confirmed", product = NUOVO) {
  const o = await t.db.sales_order.insert({ account_id: IDS.miltos, rep_id: IDS.nikos, status, source: "voice", order_date: date } as never);
  await t.db.order_line.insert({ order_id: o.id, line_no: 1, product_id: product, quantity: 2, unit_price_minor: 2150, discount_pct: 0 } as never);
}

describe("fn:campaign-funnel (REQ-CMP-003, metrics.md#campaign-funnel)", () => {
  it("J2: funnel moves from 0 to 1 pitched; contract-valid", async () => {
    const t = kit();
    expect(validateRequest("campaign-funnel", { campaign_id: CAMPAIGN }).ok).toBe(true);
    const before = ok(await handle(t.fnCtx("eleni", { campaign_id: CAMPAIGN })));
    expect(validateResponse("campaign-funnel", before).ok).toBe(true);
    const base = before.pitched;
    await expose(t, "pitched", "2026-11-16T10:00:00Z");
    const after = ok(await handle(t.fnCtx("eleni", { campaign_id: CAMPAIGN })));
    expect(after.pitched).toBe(base + 1);
    expect(after.by_rep.find((r: any) => r.rep_id === IDS.nikos)).toMatchObject({ full_name: "Nikos Alexiou", pitched: 1 });
  });

  it("shown: one per account per rep per day, inside the window; briefing items count once per rep per day", async () => {
    const t = kit();
    await expose(t, "shown", "2026-11-16T08:00:00Z");
    await expose(t, "shown", "2026-11-16T12:00:00Z"); // same day: dup
    await expose(t, "shown", "2026-11-17T08:00:00Z");
    await expose(t, "shown", "2026-11-30T08:00:00Z"); // outside window
    const b = await t.db.briefing.insert({ rep_id: IDS.dimitra, briefing_date: "2026-11-16", script_text: "x", status: "generated" } as never);
    await t.db.briefing_item.insert({ briefing_id: b.id, position: 1, item_type: "campaign", ref_table: "campaign", ref_id: CAMPAIGN, display_text: "Campaign of the week" } as never);
    const r = ok(await handle(t.fnCtx("eleni", { campaign_id: CAMPAIGN })));
    expect(r.shown).toBe(3);
    expect(r.by_rep.find((x: any) => x.rep_id === IDS.nikos)!.shown).toBe(2);
    expect(r.by_rep.find((x: any) => x.rep_id === IDS.dimitra)!.shown).toBe(1);
  });

  it("ordered: confirmed campaign-product order after the pitch and until ends_on+7; drafts, earlier orders and other products do not count", async () => {
    const t = kit();
    await expose(t, "pitched", "2026-11-17T10:00:00Z");
    await order(t, "2026-11-16"); // before pitch
    await order(t, "2026-11-18", "draft");
    await order(t, "2026-11-18", "confirmed", (await t.db.product.all()).find((p) => p.id !== NUOVO)!.id);
    expect(ok(await handle(t.fnCtx("eleni", { campaign_id: CAMPAIGN }))).ordered).toBe(0);
    await order(t, "2026-11-29"); // ends_on + 7
    await order(t, "2026-11-20"); // second order, same account: still once
    const r = ok(await handle(t.fnCtx("eleni", { campaign_id: CAMPAIGN })));
    expect(r.ordered).toBe(1);
    expect(r.by_rep.find((x: any) => x.rep_id === IDS.nikos)!.ordered).toBe(1);
  });

  it("scope: a rep sees only their own numbers; spoofed caller ignored; unknown campaign not_found", async () => {
    const t = kit();
    await expose(t, "pitched", "2026-11-16T10:00:00Z", IDS.nikos);
    await expose(t, "pitched", "2026-11-16T11:00:00Z", IDS.dimitra);
    const nikos = ok(await handle(t.fnCtx("nikos", { campaign_id: CAMPAIGN, caller: { app_user_id: IDS.eleni } })));
    expect(nikos.by_rep.map((r: any) => r.rep_id)).toEqual([IDS.nikos]);
    expect(ok(await handle(t.fnCtx("eleni", { campaign_id: CAMPAIGN }))).pitched).toBe(2);
    expect(errCode(await handle(t.fnCtx("eleni", { campaign_id: "00000000-0000-4000-8000-000000000000" })))).toBe("not_found");
    expect(errCode(await handle(t.fnCtx(null, { campaign_id: CAMPAIGN })))).toBe("forbidden");
  });

  it("functions/campaign-funnel/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "campaign-funnel", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("campaign-funnel"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
