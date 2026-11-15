import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateResponse } from "../../core/src/index";
import { kit, ok, USERS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle } from "../src/search-finalize";

describe("fn:search-finalize (REQ-PRS-001)", () => {
  it("counts found/duplicates/scored, closes the search and pushes candidates.ready to the requester", async () => {
    const t = kit();
    const s = await t.db.prospect_search.insert({ requested_by: USERS.nikos, area_text: "Chalandri", origin: "manual", status: "running" } as any);
    const mk = (status: string) => t.db.candidate.insert({ search_id: s.id, business_name: `Shop ${status}`, external_source: "csv", status } as any);
    const [a] = [await mk("scored"), await mk("duplicate"), await mk("new")];
    await t.db.candidate_score.insert({ candidate_id: a!.id, score: 70, scored_at: new Date().toISOString() } as any);
    const posts: any[] = [];
    const ctx: any = { ...t.fnCtx(null, { search_id: s.id }), api: { post: async (path: string, o: any) => { posts.push({ path, body: o.body }); return {}; } } };
    const r = ok(await handle(ctx));
    expect(r).toEqual({ found: 3, duplicates: 1, scored: 1 });
    expect(validateResponse("search-finalize", r).ok).toBe(true);
    expect(await t.db.prospect_search.get(s.id)).toMatchObject({ status: "done", found_count: 3, duplicate_count: 1 });
    expect(posts).toEqual([{ path: "/v1/function-sockets/messages", body: { channel: `rep:${USERS.nikos}`, data: { type: "candidates.ready", at: expect.any(String), payload: { search_id: s.id, found: 3, duplicates: 1, scored: 1 } } } }]);
  });

  it("without a service account the push is skipped and the search still closes", async () => {
    const t = kit();
    const s = await t.db.prospect_search.insert({ requested_by: USERS.nikos, area_text: "x", origin: "manual", status: "running" } as any);
    expect(ok(await handle(t.fnCtx(null, { search_id: s.id })))).toEqual({ found: 0, duplicates: 0, scored: 0 });
    expect((await t.db.prospect_search.get(s.id))!.status).toBe("done");
  });

  it("functions/search-finalize/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "search-finalize", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("search-finalize"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
