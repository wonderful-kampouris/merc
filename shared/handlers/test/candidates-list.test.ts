import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsTool, validateResponse } from "../../core/src/index";
import type { ModelFactory } from "../../llm/src/index";
import { kit, ok, errCode, USERS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, impl } from "../src/candidates-list";
import { makeImpl as searchImpl } from "../src/prospect-search";

const model: ModelFactory = () => ({ withStructuredOutput: () => ({ invoke: async (m: any[]) => { const vat = JSON.parse(m[1].content).dossier.summary.length % 10; return { ratings: [{ criterion: "category_fit", rating: vat / 10, reason: "fit" }] }; } }) });
async function j4(t: ReturnType<typeof kit>) {
  return ok(await defineFunction("prospect-search", searchImpl({ fetch: async () => { throw new Error("x"); }, model }))(t.fnCtx("nikos", { area_text: "Chalandri", origin: "manual" })));
}

describe("fn:candidates-list", () => {
  it("lists the J4 candidates best score first, duplicates linked to their account", async () => {
    const t = kit();
    const s = await j4(t);
    const r = ok(await handle(t.fnCtx("nikos", { search_id: s.search_id })));
    expect(validateResponse("candidates-list", r).ok).toBe(true);
    expect(r.page).toEqual({ page: 1, limit: 20, total: 18 });
    const scores = r.items.map((c) => c.score ?? -1);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(r.items.filter((c) => c.score !== null)).toHaveLength(13);
    expect(r.items.filter((c) => c.reasons.length === 3)).toHaveLength(13);
    const dups = ok(await handle(t.fnCtx("nikos", { status: "duplicate" })));
    expect(dups.items.map((c) => c.duplicate_of?.name).sort()).toEqual(["Artos Chalandriou", "Fournos Stavrou", "Glykia Gonia Bakery", "Pita & Psomi", "Zymi Bakery"]);
    const p2 = ok(await handle(t.fnCtx("nikos", { page: "2", limit: "5" })));
    expect(p2.items).toHaveLength(5);
    expect(p2.items[0]!.candidate_id).toBe(r.items[5]!.candidate_id);
  });

  it("scope: territory members and the manager see them, another territory's candidates stay hidden", async () => {
    const t = kit();
    await j4(t);
    const center = await t.db.prospect_search.insert({ requested_by: USERS.eleni, area_text: "Kolonaki", origin: "manual", status: "done" } as any);
    await t.db.candidate.insert({ search_id: center.id, business_name: "Kolonaki Bakes", postal_code: "10673", external_source: "rep", status: "new" } as any);
    expect(ok(await handle(t.fnCtx("dimitra"))).page.total).toBe(18);
    expect(ok(await handle(t.fnCtx("nikos"))).items.map((c) => c.business_name)).not.toContain("Kolonaki Bakes");
    expect(ok(await handle(t.fnCtx("eleni"))).page.total).toBe(19);
    expect(ok(await handle(t.fnCtx("thanasis"))).page.total).toBe(19);
    expect(errCode(await handle(t.fnCtx(null)))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { search_id: "00000000-0000-4000-8000-000000000000" })))).toBe("validation_failed");
    expect(ok(await runAsTool("candidates-list", impl, t.toolCtx("nikos"), { status: "scored" }, t.key)).page.total).toBe(13);
  });

  it("functions/candidates-list/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "candidates-list", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("candidates-list"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
