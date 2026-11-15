import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compactResult, prune } from "../lib/compact";

const fx = JSON.parse(readFileSync(join(__dirname, "fixtures-tool-results.json"), "utf8"));
const size = (v: unknown) => JSON.stringify(v).length;

describe("tool results the model sees", () => {
  it("prints the before/after sizes", () => {
    for (const [tool, res] of Object.entries(fx)) console.log(`${tool}: ${size(res)} -> ${size(compactResult(tool, res))}`);
  });
  it("get_today keeps stops with the ids other tools take, drops coordinates and duplicates", () => {
    const out = compactResult("get_today", fx.get_today);
    const s = JSON.stringify(out);
    expect(s).not.toContain("lat");
    expect(s).not.toContain("postal_code");
    expect(out.visits.filter((v: any) => v.stop === 1)).toHaveLength(1);
    expect(out.visits[0]).toMatchObject({ stop: 1, visit_id: "dd6c531d-1412-5df9-8f6e-5df01556c7a8", account: { id: "59b5e454-cc4b-5fab-939b-a50c78e8aa9b", name: "Café Miltos" } });
  });
  it("log_visit keeps the spoken summary and undo ids, not the action internals", () => {
    const out = compactResult("log_visit", fx.log_visit);
    expect(out.spoken_summary).toContain("Done: 6 updates saved");
    expect(out.voice_log_id).toBeTruthy();
    expect(out.undoable[0]).toEqual({ ai_action_id: "fbb5bb7a-87ae-4610-bbd0-d58a5b9bad1d", summary: "Visit note saved" });
    expect(JSON.stringify(out)).not.toMatch(/target_table|action_class|processing_ms/);
  });
  it("resolve_account resolved -> just the account", () => {
    expect(compactResult("resolve_account", fx.resolve_account)).toEqual({ status: "resolved", account: { id: "59b5e454-cc4b-5fab-939b-a50c78e8aa9b", name: "Café Miltos", type: "customer", city: "Chalandri" } });
  });
  it("errors pass through untouched", () => {
    expect(compactResult("record_feedback", fx.record_feedback)).toEqual(fx.record_feedback);
    const e = { error: { code: "forbidden", message: "x" } };
    expect(compactResult("get_today", e)).toBe(e);
  });
  it("prune keeps useful ids and drops the rest", () => {
    expect(prune({ id: "x", approval_id: "a", ref_id: "r", note: null, items: [], account: { id: "acc", name: "N", postal_code: "1" } })).toEqual({ approval_id: "a", account: { id: "acc", name: "N" } });
  });
});
