import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsTool, validateResponse } from "../../core/src/index";
import type { ModelFactory } from "../../llm/src/index";
import { kit, ok, errCode, IDS, USERS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, impl, makeImpl } from "../src/candidate-add";

const model: ModelFactory = () => ({ withStructuredOutput: () => ({ invoke: async () => ({ ratings: [{ criterion: "category_fit", rating: 1, reason: "A bakery" }] }) }) });
const entry = defineFunction("candidate-add", makeImpl({ fetch: async () => { throw new Error("no network"); }, model }));

describe("fn:candidate-add (REQ-PRS-008)", () => {
  it('"New bakery next to Miltos" creates a candidate near Café Miltos, scored inline', async () => {
    const t = kit();
    const r = ok(await entry(t.fnCtx("nikos", { business_name: "Neos Fournos", location_hint: "next to Miltos", caller: { user_id: USERS.dimitra } })));
    expect(validateResponse("candidate-add", r).ok).toBe(true);
    expect(r.duplicate_of).toBeNull();
    const c = (await t.db.candidate.get(r.candidate_id))!;
    const miltos = (await t.db.account.get(IDS.miltos))!;
    expect(c).toMatchObject({ search_id: r.search_id, external_source: "rep", postal_code: miltos.postal_code, lat: miltos.lat, lng: miltos.lng, assigned_rep_id: USERS.nikos, status: "scored" });
    expect(await t.db.prospect_search.get(r.search_id)).toMatchObject({ origin: "single_add", requested_by: USERS.nikos, status: "done", found_count: 1, duplicate_count: 0 });
  });

  it("a shop that is already an account returns duplicate_of", async () => {
    const t = kit();
    const r = ok(await entry(t.fnCtx("nikos", { business_name: "Zymi", website: "www.zymi.example.gr/" })));
    expect(r.duplicate_of).toMatchObject({ name: "Zymi Bakery", account_type: "customer" });
    expect(await t.db.prospect_search.get(r.search_id)).toMatchObject({ status: "done", found_count: 1, duplicate_count: 1 });
  });

  it("postal codes in the hint; unknown codes stay null; bad website -> validation_failed; no user -> forbidden", async () => {
    const t = kit();
    const a = ok(await entry(t.fnCtx("nikos", { business_name: "Shop A", location_hint: "Odos X, 152 32" })));
    expect((await t.db.candidate.get(a.candidate_id))!.postal_code).toBe("15232");
    const b = ok(await entry(t.fnCtx("nikos", { business_name: "Shop B", location_hint: "99999" })));
    expect((await t.db.candidate.get(b.candidate_id))!.postal_code).toBeNull();
    expect(errCode(await entry(t.fnCtx("nikos", { business_name: "Shop C", website: "not a site" })))).toBe("validation_failed");
    expect(errCode(await handle(t.fnCtx(null, { business_name: "Shop D" })))).toBe("forbidden");
  });

  it("the buddy tool path runs the same impl", async () => {
    const t = kit();
    const r = ok(await runAsTool("candidate-add", impl, t.toolCtx("nikos"), { business_name: "Psomi Voice", phone: "210 680 9999" }, t.key));
    expect((await t.db.candidate.get(r.candidate_id))!.phone).toBe("+302106809999");
  });

  it("functions/candidate-add/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "candidate-add", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("candidate-add"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
