import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateResponse } from "../../core/src/index";
import { kit, ok, errCode, USERS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle } from "../src/candidate-get";

describe("fn:candidate-get", () => {
  it("returns the CandidateCard plus website and VAT for merc-research", async () => {
    const t = kit();
    const s = await t.db.prospect_search.insert({ requested_by: USERS.nikos, area_text: "Chalandri", origin: "manual", status: "running" } as any);
    const c = await t.db.candidate.insert({ search_id: s.id, business_name: "Bakery Elia", vat_number: "900000202", website: "https://bakeryelia.example.gr", postal_code: "15233", external_source: "csv", status: "new" } as any);
    const r = ok(await handle(t.fnCtx(null, { candidate_id: c.id, caller: { user_id: USERS.thanasis } })));
    expect(validateResponse("candidate-get", r).ok).toBe(true);
    expect(r).toEqual({
      candidate: { candidate_id: c.id, business_name: "Bakery Elia", status: "new", postal_code: "15233", website: "https://bakeryelia.example.gr", score: null, reasons: [], dossier: null, duplicate_of: null, assigned_rep: null },
      website: "https://bakeryelia.example.gr", vat_number: "900000202",
    });
  });

  it("unknown id -> not_found", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx(null, { candidate_id: "00000000-0000-4000-8000-000000000000" })))).toBe("not_found");
  });

  it("functions/candidate-get/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "candidate-get", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("candidate-get"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
