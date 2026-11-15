import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsTool, validateResponse } from "../../core/src/index";
import type { ModelFactory } from "../../llm/src/index";
import { kit, ok, errCode, USERS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, impl, makeImpl, resolveCategory, type PipelineDeps } from "../src/prospect-search";

const model: ModelFactory = () => ({ withStructuredOutput: () => ({ invoke: async () => ({ ratings: ["category_fit", "size_activity", "replaceable_brands", "reviews_traffic"].map((criterion) => ({ criterion, rating: 0.7, reason: `${criterion} ok` })) }) }) });
const noNet = async () => { throw new Error("no network"); };
const entry = (deps: Partial<PipelineDeps>) => defineFunction("prospect-search", makeImpl({ fetch: noNet, model, ...deps }));
const J4 = { area_text: "Chalandri", category_text: "bakeries", origin: "manual" };

describe("fn:prospect-search (REQ-PRS-001)", () => {
  it("J4 inline chain: 18 found, 5 duplicates, 13 scored, done, candidates.ready pushed to the rep", async () => {
    const t = kit();
    const posts: any[] = [];
    const t0 = Date.now();
    const r = ok(await entry({ api: { post: async (_p, o) => { posts.push(o?.body); return {}; } } })(t.fnCtx("nikos", J4)));
    expect(Date.now() - t0).toBeLessThan(5 * 60_000);
    expect(validateResponse("prospect-search", r).ok).toBe(true);
    expect(r.status).toBe("done");
    const s = (await t.db.prospect_search.get(r.search_id))!;
    expect(s).toMatchObject({ requested_by: USERS.nikos, status: "done", found_count: 18, duplicate_count: 5, category_id: "10169ea8-bbde-567f-93b2-d5686ea70ef4" });
    expect(posts).toEqual([{ channel: `rep:${USERS.nikos}`, data: { type: "candidates.ready", at: expect.any(String), payload: { search_id: r.search_id, found: 18, duplicates: 5, scored: 13 } } }]);
  });

  it("procedure configured: invokes prospecting-pipeline with the search id and stores the run id", async () => {
    const t = kit({ globals: { MERC_PROSPECTING_PROCEDURE_ID: "proc-1" } });
    const calls: any[] = [];
    const r = ok(await entry({ automations: { invoke: async (o) => { calls.push(o); return { runId: "run-9", status: "queued" }; } } })(t.fnCtx("nikos", J4)));
    expect(r.status).toBe("running");
    expect(calls).toEqual([{ automationId: "proc-1", input: { search_id: r.search_id } }]);
    expect((await t.db.prospect_search.get(r.search_id))!.procedure_run_id).toBe("run-9");
    expect(await t.db.candidate.all({ search_id: r.search_id })).toHaveLength(0);
  });

  it("procedure invoke fails -> inline fallback; no model in the runtime -> search stays running for the app to poll", async () => {
    const t = kit({ globals: { MERC_PROSPECTING_PROCEDURE_ID: "proc-1" } });
    const r = ok(await entry({ automations: { invoke: async () => { throw new Error("not published"); } } })(t.fnCtx("nikos", J4)));
    expect(r.status).toBe("done");
    // a second search of the same area: every shop is now a duplicate of the first search's candidates
    const again = ok(await entry({})(t.fnCtx("dimitra", J4)));
    expect(await t.db.candidate.count({ search_id: again.search_id, status: "duplicate" })).toBe(18);
    const fresh = kit();
    const viaDeployed = ok(await handle(fresh.fnCtx("dimitra", J4)));
    expect(viaDeployed.status).toBe("running");
    expect(await fresh.db.candidate.count({ search_id: viaDeployed.search_id, status: "duplicate" })).toBe(5);
    expect(await fresh.db.candidate.count({ search_id: viaDeployed.search_id, status: "new" })).toBe(13);
  });

  it("Overpass down outside the CSV area -> status failed, search kept", async () => {
    const t = kit();
    const r = ok(await entry({ fetch: async () => ({ ok: false, status: 400, json: async () => ({}) }) })(t.fnCtx("nikos", { area_text: "Marousi", origin: "manual" })));
    expect(r.status).toBe("failed");
    expect((await t.db.prospect_search.get(r.search_id))!.status).toBe("failed");
  });

  it("identity: no user -> forbidden; spoofed caller ignored; unknown category -> validation_failed; tool path", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx(null, J4)))).toBe("forbidden");
    const r = ok(await entry({ budgetMs: 0 })(t.fnCtx("nikos", { ...J4, caller: { user_id: USERS.thanasis } })));
    expect((await t.db.prospect_search.get(r.search_id))!.requested_by).toBe(USERS.nikos);
    expect(errCode(await handle(t.fnCtx("nikos", { ...J4, category_id: "00000000-0000-4000-8000-000000000000" })))).toBe("validation_failed");
    const viaTool = ok(await runAsTool("prospect-search", impl, t.toolCtx("nikos"), { area_text: "Chalandri", origin: "manual" }, t.key));
    expect((await t.db.prospect_search.get(viaTool.search_id))!.requested_by).toBe(USERS.nikos);
    expect(await resolveCategory(t.db, "Καφέ")).toBe(null);
    expect(await resolveCategory(t.db, "cafes")).toBe("5a1d91e1-bd02-5226-ba0c-74b19254ab62");
    expect(await resolveCategory(t.db, "Bakeries")).toBe("10169ea8-bbde-567f-93b2-d5686ea70ef4");
  });

  it("functions/prospect-search/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "prospect-search", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("prospect-search"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
