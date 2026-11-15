import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateResponse } from "../../core/src/index";
import { kit, ok, errCode, USERS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, sourceProblem } from "../src/dossier-save";
import { handle as getCandidate } from "../src/candidate-get";

async function setup() {
  const t = kit();
  const s = await t.db.prospect_search.insert({ requested_by: USERS.nikos, area_text: "Chalandri", origin: "manual", status: "running" } as any);
  const c = await t.db.candidate.insert({ search_id: s.id, business_name: "Bakery Elia", website: "https://bakeryelia.example.gr", postal_code: "15233", external_source: "csv", status: "new" } as any);
  return { t, c };
}
const fact = (source_url: string, extra: Record<string, unknown> = {}) => ({ fact_type: "product", value: "Sourdough, croissants", source_url, ...extra });

describe("fn:dossier-save (REQ-PRS-003, REQ-PRS-005)", () => {
  it("rejects a google.com/maps source and keeps every other fact with its source and retrieval time", async () => {
    const { t, c } = await setup();
    const r = ok(await handle(t.fnCtx(null, { candidate_id: c.id, summary: "Artisan bakery", price_level: "mid", research_task_id: "task-1", facts: [
      fact("https://bakeryelia.example.gr/products"),
      fact("https://www.google.com/maps/place/Bakery+Elia"),
      { fact_type: "brand", value: "Serves BlueBean Roasters espresso", source_url: "https://bakeryelia.example.gr/cafe" },
      fact("https://www.tripadvisor.com/Restaurant_Review-x"),
      { fact_type: "gossip", value: "x", source_url: "https://bakeryelia.example.gr" },
    ] })));
    expect(r).toEqual({ dossier_id: expect.any(String), facts_saved: 2, facts_rejected: 3 });
    expect(validateResponse("dossier-save", r).ok).toBe(true);
    const facts = await t.db.dossier_fact.all({ dossier_id: r.dossier_id });
    expect(facts.every((f) => f.source_url.startsWith("https://bakeryelia.example.gr") && !Number.isNaN(Date.parse(String(f.retrieved_at))))).toBe(true);
    expect(facts.find((f) => f.fact_type === "brand")!.competitor_id).toBe("8fac56e5-0862-50b1-b242-bb37ac0c98e1");
    expect((await t.db.candidate.get(c.id))!.status).toBe("researched");
    const card = ok(await getCandidate(t.fnCtx(null, { candidate_id: c.id }))).candidate;
    expect(card.dossier!.competitor_brands).toEqual(["BlueBean Roasters"]);
    expect(card.dossier!.facts).toHaveLength(2);
  });

  it("no website: a registry-only dossier is saved; a new research replaces the old facts", async () => {
    const { t, c } = await setup();
    const a = ok(await handle(t.fnCtx(null, { candidate_id: c.id, summary: "no website", facts: [fact("https://opendata-api.businessportal.gr/api/opendata/v1/companies/1")] })));
    const b = ok(await handle(t.fnCtx(null, { candidate_id: c.id, summary: "no website", facts: [] })));
    expect(b.dossier_id).toBe(a.dossier_id);
    expect(await t.db.dossier_fact.all({ dossier_id: a.dossier_id })).toHaveLength(0);
  });

  it("needs a candidate or an account; unknown ids -> not_found", async () => {
    const { t } = await setup();
    expect(errCode(await handle(t.fnCtx(null, { summary: "x", facts: [] })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx(null, { candidate_id: "00000000-0000-4000-8000-000000000000", summary: "x", facts: [] })))).toBe("not_found");
    const acc = ok(await handle(t.fnCtx(null, { account_id: "59b5e454-cc4b-5fab-939b-a50c78e8aa9b", summary: "Café Miltos refresh", facts: [] })));
    expect(acc.facts_saved).toBe(0);
  });

  it("source rules", () => {
    expect(sourceProblem("https://maps.app.goo.gl/abc")).toBeTruthy();
    expect(sourceProblem("https://maps.apple.com/?q=x")).toBeTruthy();
    expect(sourceProblem("https://example.gr/maps/shop")).toBe("maps service");
    expect(sourceProblem("https://www.yelp.com/biz/x")).toBeTruthy();
    expect(sourceProblem("ftp://x.gr")).toBeTruthy();
    expect(sourceProblem("")).toBe("missing source_url");
    expect(sourceProblem("https://tassis.gr/")).toBeNull();
  });

  it("functions/dossier-save/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "dossier-save", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("dossier-save"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
