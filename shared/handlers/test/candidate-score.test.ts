import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateResponse } from "../../core/src/index";
import type { ModelFactory } from "../../llm/src/index";
import { kit, ok, errCode, USERS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { candidatePoint, handle, makeImpl, nearRouteRating, routeDistanceM, topReasons, weightedScore } from "../src/candidate-score";
import { defineSystemFunction, orgOfCandidate } from "../src/candidate-get";

const RATINGS: Record<string, number> = { category_fit: 0.9, size_activity: 0.6, replaceable_brands: 0.5, reviews_traffic: 0.4, near_route: 0 };
function fakeModel(r: Record<string, number> = RATINGS, seen: unknown[] = []): ModelFactory {
  return () => ({ withStructuredOutput: () => ({ invoke: async (msgs: unknown[]) => { seen.push(msgs); return { ratings: Object.entries(r).map(([criterion, rating]) => ({ criterion, rating, reason: `${criterion} because` })) }; } }) });
}
const entry = (model: ModelFactory) => defineSystemFunction("candidate-score", () => makeImpl({ model }), (api, req) => orgOfCandidate(api, req.candidate_id));
async function setup() {
  const t = kit();
  const s = await t.db.prospect_search.insert({ requested_by: USERS.nikos, area_text: "Chalandri", origin: "manual", status: "running", category_id: "10169ea8-bbde-567f-93b2-d5686ea70ef4" } as any);
  const c = await t.db.candidate.insert({ search_id: s.id, business_name: "Bakery Elia", postal_code: "15233", external_source: "csv", status: "researched" } as any);
  return { t, c };
}

describe("fn:candidate-score (REQ-PRS-004)", () => {
  it("weights in code, near_route from distance, top 3 reasons stored, candidate scored", async () => {
    const { t, c } = await setup();
    const seen: any[] = [];
    const r = ok(await entry(fakeModel(RATINGS, seen))(t.fnCtx(null, { candidate_id: c.id })));
    expect(validateResponse("candidate-score", r).ok).toBe(true);
    const me = await t.system("procedure");
    const d = await routeDistanceM(t.db, me.org, USERS.nikos, await candidatePoint(t.db, c), Date.now());
    expect(d).not.toBeNull();
    const near = nearRouteRating(d);
    expect(r.score).toBe(Math.round((100 * (3 * 0.9 + 2 * near + 2 * 0.6 + 2 * 0.5 + 1 * 0.4)) / 10));
    expect(r.reasons).toHaveLength(3);
    expect(r.reasons[0]).toEqual({ criterion: "category_fit", reason: "category_fit because" });
    const input = JSON.parse(seen[0][1].content);
    expect(input.icp.criteria.map((x: any) => x.criterion)).not.toContain("near_route");
    expect(input.distance_to_route_m).toBe(d);
    expect(input.icp.target_categories).toEqual(["Bakery", "Café"]);
    expect((await t.db.candidate.get(c.id))!.status).toBe("scored");
    const stored = await t.db.candidate_score_reason.all({}, { orderBy: [{ column: "rank", direction: "asc" }] });
    expect(stored.map((x) => x.rank)).toEqual([1, 2, 3]);
  });

  it("re-scoring the same dossier gives the same score within ±1 (small rating jitter)", async () => {
    const { t, c } = await setup();
    const a = ok(await entry(fakeModel())(t.fnCtx(null, { candidate_id: c.id })));
    const jitter = Object.fromEntries(Object.entries(RATINGS).map(([k, v]) => [k, Math.min(1, v + (k.length % 2 ? 0.02 : -0.02))]));
    const b = ok(await entry(fakeModel(jitter))(t.fnCtx(null, { candidate_id: c.id })));
    const same = ok(await entry(fakeModel())(t.fnCtx(null, { candidate_id: c.id })));
    expect(Math.abs(a.score - b.score)).toBeLessThanOrEqual(1);
    expect(same.score).toBe(a.score);
  });

  it("an invalid model answer twice -> validation_failed, nothing stored; no runtime model -> upstream_failed", async () => {
    const { t, c } = await setup();
    const bad: ModelFactory = () => ({ withStructuredOutput: () => ({ invoke: async () => ({ nope: 1 }) }) });
    expect(errCode(await entry(bad)(t.fnCtx(null, { candidate_id: c.id })))).toBe("validation_failed");
    expect(await t.db.candidate_score.all()).toHaveLength(0);
    expect(errCode(await handle(t.fnCtx(null, { candidate_id: c.id })))).toBe("upstream_failed");
  });

  it("math helpers", () => {
    expect(nearRouteRating(100)).toBe(1);
    expect(nearRouteRating(2750)).toBe(0.5);
    expect(nearRouteRating(9000)).toBe(0);
    expect(nearRouteRating(null)).toBe(0.5);
    const rated = [{ criterion: "a", weight: 3, rating: 1, reason: "A" }, { criterion: "b", weight: 1, rating: 1, reason: "B" }, { criterion: "c", weight: 2, rating: 1, reason: "C" }, { criterion: "d", weight: 2, rating: 0, reason: "D" }];
    expect(weightedScore(rated)).toBe(75);
    expect(topReasons(rated).map((x) => x.reason)).toEqual(["A", "C", "B"]);
  });

  it("functions/candidate-score/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "candidate-score", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("candidate-score"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
