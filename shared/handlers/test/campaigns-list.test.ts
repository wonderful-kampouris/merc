import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateRequest, validateResponse } from "../../core/src/index";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle } from "../src/campaigns-list";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";

const SEED_CAMPAIGN = "006021ba-1b63-5646-9d18-85a40098c0c9";
const NUOVO = "b28bc378-ec47-55d6-a414-b09ac0dacc3d";
const CAFE = "5a1d91e1-bd02-5226-ba0c-74b19254ab62";
const SOUTH = "5963cd69-93fb-53ce-9745-f1d136a46285";

async function addCampaign(t: ReturnType<typeof kit>, status: string, territory?: string) {
  const c = await t.db.campaign.insert({ created_by: IDS.eleni, title: `T ${status} ${territory ?? "all"}`, message: "m", starts_on: "2026-11-16", ends_on: "2026-11-22", status } as never);
  if (territory) await t.db.campaign_territory.insert({ campaign_id: c.id, territory_id: territory } as never);
  return c.id;
}

describe("fn:campaigns-list (REQ-CMP-002)", () => {
  it("manager sees the seeded campaign with link ids and names; contract-valid", async () => {
    const t = kit();
    expect(validateRequest("campaigns-list", {}).ok).toBe(true);
    const r = ok(await handle(t.fnCtx("eleni", {})));
    expect(validateResponse("campaigns-list", r).ok).toBe(true);
    const c = r.items.find((i: any) => i.id === SEED_CAMPAIGN) as any;
    expect(c).toMatchObject({ title: "Espresso Nuovo to cafés", status: "active", product_ids: [NUOVO], category_ids: [CAFE], rep_ids: [] });
    expect(c.territory_ids.sort()).toEqual([IDS.north, IDS.center].sort());
    expect(c.product_names).toEqual(["Espresso Nuovo Blend 1kg"]);
    expect(c.territory_names.sort()).toEqual(["Center", "North"]);
    expect(c.category_names).toEqual(["Café"]);
  });

  it("status filter; GET params coerced", async () => {
    const t = kit();
    await addCampaign(t, "draft", IDS.north);
    const drafts = ok(await handle(t.fnCtx("eleni", { status: "draft" })));
    expect(drafts.items.every((i: any) => i.status === "draft")).toBe(true);
    expect(drafts.items.length).toBe(1);
  });

  it("rep sees only non-draft campaigns that target them (REQ-CORE-009)", async () => {
    const t = kit();
    const draft = await addCampaign(t, "draft", IDS.north);
    const south = await addCampaign(t, "active", SOUTH);
    const untargeted = await addCampaign(t, "active");
    const ids = ok(await handle(t.fnCtx("nikos", {}))).items.map((i: any) => i.id);
    expect(ids).toContain(SEED_CAMPAIGN);
    expect(ids).toContain(untargeted);
    expect(ids).not.toContain(draft);
    expect(ids).not.toContain(south);
    const mgr = ok(await handle(t.fnCtx("eleni", {}))).items.map((i: any) => i.id);
    expect(mgr).toEqual(expect.arrayContaining([draft, south, untargeted, SEED_CAMPAIGN]));
  });

  it("no Merc user -> forbidden; spoofed caller ignored", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx(null, {})))).toBe("forbidden");
    const r = ok(await handle(t.fnCtx("nikos", { caller: { app_user_id: IDS.eleni } })));
    expect(r.items.every((i: any) => i.status !== "draft")).toBe(true);
  });

  it("functions/campaigns-list/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "campaigns-list", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("campaigns-list"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
