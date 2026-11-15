import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateRequest, validateResponse } from "../../core/src/index";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, makeImpl, resolveName, scanText, tokens } from "../src/campaign-draft-from-text";
import { handle as upsert } from "../src/campaign-upsert";
import { defineFunction } from "../../core/src/index";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";

const NUOVO = "b28bc378-ec47-55d6-a414-b09ac0dacc3d";
const CAFE = "5a1d91e1-bd02-5226-ba0c-74b19254ab62";
const TEXT = "Push Espresso Nuovo to cafés in North and Center this week";
const MONDAY = Date.parse("2026-11-16T09:00:00Z");
const LLM_OUT = { title: "Espresso Nuovo to cafés", message: "Push Espresso Nuovo to cafés this week.", starts_on: "2026-11-16", ends_on: "2026-11-22", product_names: ["Espresso Nuovo"], territory_names: ["North", "Center"], category_names: ["cafés"], rep_names: [] };
const fakeModel = (out: unknown, seen?: { input?: any }) => () => ({ withStructuredOutput: () => ({ invoke: async (m: any[]) => { if (seen) seen.input = JSON.parse(m[1].content); return out; } }) });
const run = (deps: Parameters<typeof makeImpl>[0]) => defineFunction("campaign-draft-from-text", makeImpl({ now: () => MONDAY, ...deps }));

describe("fn:campaign-draft-from-text (REQ-CMP-001)", () => {
  it("J-acceptance: the demo sentence fills the form (product, territories, category, this week); contract-valid", async () => {
    const t = kit();
    const seen: { input?: any } = {};
    expect(validateRequest("campaign-draft-from-text", { text: TEXT }).ok).toBe(true);
    const r = ok(await run({ model: fakeModel(LLM_OUT, seen) as never })(t.fnCtx("eleni", { text: TEXT })));
    expect(validateResponse("campaign-draft-from-text", r).ok).toBe(true);
    expect(seen.input).toMatchObject({ text: TEXT, today: "2026-11-16" });
    expect(seen.input.products).toContain("Espresso Nuovo Blend 1kg");
    expect(seen.input.reps).toContain("Nikos Alexiou");
    expect(r.unresolved).toEqual([]);
    expect(r.draft).toMatchObject({ status: "draft", starts_on: "2026-11-16", ends_on: "2026-11-22", product_ids: [NUOVO], territory_ids: [IDS.north, IDS.center], category_ids: [CAFE], rep_ids: [], source: "llm" });
    // the draft is directly submittable to campaign-upsert
    const { product_names, territory_names, category_names, rep_names, source, ...form } = r.draft as any;
    expect(product_names).toEqual(["Espresso Nuovo Blend 1kg"]);
    expect(ok(await upsert(t.fnCtx("eleni", form))).campaign_id).toBeTruthy();
  });

  it("names the model invents or that are ambiguous go to unresolved", async () => {
    const t = kit();
    const out = { ...LLM_OUT, product_names: ["Espresso Nuovo", "Super Latte", "Espresso"], territory_names: ["Crete"], rep_names: ["Nikos"] };
    const r = ok(await run({ model: fakeModel(out) as never })(t.fnCtx("eleni", { text: TEXT })));
    expect(r.unresolved).toEqual(["Super Latte", "Espresso", "Crete"]);
    expect((r.draft as any).product_ids).toEqual([NUOVO]);
    expect((r.draft as any).rep_ids).toEqual([IDS.nikos]);
  });

  it("missing dates default to a 7-day window from today; past dates are clamped to today", async () => {
    const t = kit();
    const r = ok(await run({ model: fakeModel({ ...LLM_OUT, starts_on: null, ends_on: null }) as never })(t.fnCtx("eleni", { text: TEXT })));
    expect(r.draft).toMatchObject({ starts_on: "2026-11-16", ends_on: "2026-11-22" });
    const r2 = ok(await run({ model: fakeModel({ ...LLM_OUT, starts_on: "2026-11-01", ends_on: "2026-11-02" }) as never })(t.fnCtx("eleni", { text: TEXT })));
    expect(r2.draft).toMatchObject({ starts_on: "2026-11-16", ends_on: "2026-11-22" });
  });

  it("model unavailable -> deterministic scan still fills the demo form", async () => {
    const t = kit();
    const logs: string[] = [];
    const broken = () => { throw new Error("ModelProfiles runtime global is not available"); };
    const r = ok(await run({ model: broken as never, log: (m) => logs.push(m) })(t.fnCtx("eleni", { text: TEXT })));
    expect(r.draft).toMatchObject({ source: "fallback", product_ids: [NUOVO], category_ids: [CAFE], status: "draft" });
    expect(((r.draft as any).territory_ids as string[]).sort()).toEqual([IDS.north, IDS.center].sort());
    expect(logs.join(" ")).toMatch(/deterministic/);
    // the default deployed entry has no ModelProfiles global in tests -> same fallback
    expect((ok(await handle(t.fnCtx("eleni", { text: TEXT }))).draft as any).source).toBe("fallback");
  });

  it("reps cannot draft campaigns; empty text invalid; no user forbidden", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", { text: TEXT })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx(null, { text: TEXT })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("eleni", { text: "   " })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx("eleni", {})))).toBe("validation_failed");
  });

  it("name resolution helpers", () => {
    const cands = [{ id: "1", name: "Café" }, { id: "2", name: "Bakery" }, { id: "3", name: "Mini market" }];
    expect(tokens("Cafés")).toEqual(["cafe"]);
    expect(resolveName("cafes", cands)?.id).toBe("1");
    expect(resolveName("bakeries", cands)?.id).toBe("2");
    expect(resolveName("mini", cands)?.id).toBe("3");
    expect(resolveName("hotel", cands)).toBeNull();
    expect(scanText("push to bakeries and mini markets", cands)).toEqual(["Bakery", "Mini market"]);
  });

  it("functions/campaign-draft-from-text/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "campaign-draft-from-text", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("campaign-draft-from-text"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
