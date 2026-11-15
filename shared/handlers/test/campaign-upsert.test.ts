import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateRequest, validateResponse } from "../../core/src/index";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle } from "../src/campaign-upsert";
import { handle as list } from "../src/campaigns-list";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";

const NUOVO = "b28bc378-ec47-55d6-a414-b09ac0dacc3d";
const CAFE = "5a1d91e1-bd02-5226-ba0c-74b19254ab62";
const SEED_CAMPAIGN = "006021ba-1b63-5646-9d18-85a40098c0c9";
const body = (over: Record<string, unknown> = {}) => ({
  title: "Nuovo push", message: "Offer a 1 kg trial bag.", starts_on: "2026-11-16", ends_on: "2026-11-22", status: "active",
  product_ids: [NUOVO], territory_ids: [IDS.north], category_ids: [CAFE], rep_ids: [], ...over,
});

describe("fn:campaign-upsert (REQ-CMP-002)", () => {
  it("manager creates an active campaign with links; contract-valid; targeted rep sees it, others do not", async () => {
    const t = kit();
    expect(validateRequest("campaign-upsert", body()).ok).toBe(true);
    const r = ok(await handle(t.fnCtx("eleni", body())));
    expect(validateResponse("campaign-upsert", r).ok).toBe(true);
    const c = (await t.db.campaign.get(r.campaign_id))!;
    expect(c).toMatchObject({ title: "Nuovo push", status: "active", created_by: IDS.eleni, org_id: IDS.org });
    expect((await t.db.campaign_product.all({ campaign_id: c.id })).map((x) => x.product_id)).toEqual([NUOVO]);
    expect((await t.db.campaign_territory.all({ campaign_id: c.id })).map((x) => x.territory_id)).toEqual([IDS.north]);
    expect(ok(await list(t.fnCtx("nikos", {}))).items.map((i: any) => i.id)).toContain(c.id);
  });

  it("edit syncs links (add and remove) and round-trips campaigns-list", async () => {
    const t = kit();
    const { campaign_id } = ok(await handle(t.fnCtx("eleni", body())));
    ok(await handle(t.fnCtx("eleni", body({ campaign_id, title: "Nuovo push v2", territory_ids: [IDS.center], rep_ids: [IDS.nikos], status: "ended" }))));
    const item = ok(await list(t.fnCtx("eleni", {}))).items.find((i: any) => i.id === campaign_id) as any;
    expect(item).toMatchObject({ title: "Nuovo push v2", status: "ended", territory_ids: [IDS.center], rep_ids: [IDS.nikos], product_ids: [NUOVO] });
  });

  it("validation: unknown ids, non-rep in rep_ids, ends before starts, blank title", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("eleni", body({ product_ids: ["00000000-0000-4000-8000-000000000000"] }))))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("eleni", body({ rep_ids: [IDS.eleni] }))))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("eleni", body({ ends_on: "2026-11-01" }))))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("eleni", body({ title: "  " }))))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("eleni", body({ status: "live" }))))).toBe("validation_failed");
  });

  it("reps cannot manage campaigns; no user -> forbidden; spoofed caller ignored", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", body())))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx(null, body())))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { ...body(), caller: { app_user_id: IDS.eleni } })))).toBe("forbidden");
  });

  it("a manager outside the team cannot target other territories, untargeted, or edit others' campaigns", async () => {
    const t = kit();
    const mgr = await t.db.app_user.insert({ wonderful_user_id: "wuid-mgr2", role_code: "manager", manager_id: IDS.thanasis, full_name: "Other Manager", email: "m2@merc.test", preferred_language: "en", voice_enabled: false, status: "active" } as never);
    const ctx = (data: unknown) => { const c = t.fnCtx("eleni", data) as any; c.metadata.user.id = "wuid-mgr2"; return c; };
    expect(errCode(await handle(ctx(body())))).toBe("forbidden");
    expect(errCode(await handle(ctx(body({ territory_ids: [] }))))).toBe("forbidden");
    expect(errCode(await handle(ctx(body({ campaign_id: SEED_CAMPAIGN, territory_ids: [] }))))).toBe("forbidden");
    expect(mgr.id).toBeTruthy();
    // admin may create an org-wide (untargeted) campaign
    expect(ok(await handle(t.fnCtx("thanasis", body({ territory_ids: [] })))).campaign_id).toBeTruthy();
  });

  it("unknown campaign_id -> not_found", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("eleni", body({ campaign_id: "00000000-0000-4000-8000-000000000000" }))))).toBe("not_found");
  });

  it("functions/campaign-upsert/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "campaign-upsert", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("campaign-upsert"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
