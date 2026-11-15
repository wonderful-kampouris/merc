import { describe, expect, it } from "vitest";
import { validateResponse } from "../../../../contracts";
import { AVRA, MILTOS, avraCard, briefingResult, miltosCard, performanceResult, planResult, todayResult } from "./fixtures";

// The fixtures stand in for the real functions in tests and in the evidence screenshots; they must stay contract-valid.
describe("screen fixtures", () => {
  it.each([
    ["today-get", todayResult()],
    ["briefing-get", briefingResult()],
    ["visit-plan-get", planResult()],
    ["my-performance", performanceResult()],
    ["visit-card-get", miltosCard()],
    ["visit-card-get", avraCard()],
  ] as const)("%s fixture validates against the contract", (slug, value) => {
    const r = validateResponse(slug, value);
    expect(r.ok, r.ok ? "" : JSON.stringify(r)).toBe(true);
  });

  it("uses the seed ids for Café Miltos and Café Avra", () => {
    expect(MILTOS).toBe("59b5e454-cc4b-5fab-939b-a50c78e8aa9b");
    expect(AVRA).toBe("ef86a932-3241-51c8-b7be-1df72dbf74f9");
    expect(avraCard().account.id).toBe(AVRA);
  });
});
