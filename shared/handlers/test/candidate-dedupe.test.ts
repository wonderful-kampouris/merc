import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateResponse } from "../../core/src/index";
import { kit, ok, errCode, USERS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS, ROOT } from "../src/_lib/bundle";
import { handle, normDomain, normName, normPhone, normVat, similarity } from "../src/candidate-dedupe";
import { csvCandidates } from "../src/directory-search";

const seedList = () => JSON.parse(readFileSync(join(ROOT, "spec/contracts/seed/prospect_list_chalandri_bakeries.json"), "utf8")) as Array<{ business_name: string; expected: string }>;
async function csvSearch(t: ReturnType<typeof kit>) {
  const s = await t.db.prospect_search.insert({ requested_by: USERS.nikos, area_text: "Chalandri", origin: "manual", status: "running" } as any);
  const rows = [];
  for (const r of csvCandidates()) rows.push(await t.db.candidate.insert({ ...r, search_id: s.id, status: "new" } as any));
  return { s, rows };
}

describe("fn:candidate-dedupe (REQ-PRS-002)", () => {
  it("the seeded prospect list flags exactly the 5 expected duplicates with the right rule", async () => {
    const t = kit();
    const { rows } = await csvSearch(t);
    const got: Record<string, string> = {};
    for (const c of rows) {
      const r = ok(await handle(t.fnCtx(null, { candidate_id: c.id })));
      expect(validateResponse("candidate-dedupe", r).ok).toBe(true);
      got[c.business_name] = r.duplicate ? `duplicate:${r.rule}` : "new";
      if (r.duplicate) expect(r.matched_account_id).toBeTruthy();
    }
    expect(got).toEqual(Object.fromEntries(seedList().map((r) => [r.business_name, r.expected])));
    const flagged = (await t.db.candidate.all({ status: "duplicate" }));
    expect(flagged).toHaveLength(5);
    const stavrou = flagged.find((c) => c.business_name === "FOURNOS STAVROU")!;
    expect((await t.db.account.get(stavrou.matched_account_id!))!.name).toBe("Fournos Stavrou");
  });

  it("two copies of the same new shop: only one is flagged (against the other candidate)", async () => {
    const t = kit();
    const { s, rows } = await csvSearch(t);
    const orig = rows.find((r) => r.business_name === "Bakery Elia")!;
    const copy = await t.db.candidate.insert({ search_id: s.id, business_name: "BAKERY ELIA", postal_code: "15233", external_source: "rep", status: "new" } as any);
    const r = ok(await handle(t.fnCtx(null, { candidate_id: copy.id })));
    expect(r).toEqual({ duplicate: true, matched_account_id: null, matched_candidate_id: orig.id, rule: "name" });
    expect(ok(await handle(t.fnCtx(null, { candidate_id: orig.id }))).duplicate).toBe(false);
  });

  it("normalizers", () => {
    expect(normVat("EL 800-039-595")).toBe("800039595");
    expect(normVat("12345")).toBeNull();
    expect(normDomain("HTTPS://www.Zymi.example.gr/menu?x=1")).toBe("zymi.example.gr");
    expect(normDomain("not a site")).toBeNull();
    expect(normPhone("210 600 0959")).toBe("+302106000959");
    expect(normPhone("0030 6912345678")).toBe("+306912345678");
    expect(normPhone("12")).toBeNull();
    expect(normName("Φούρνος Σταύρου")).toBe("fournos stavrou".replace("v", "y"));
    expect(similarity("FOURNOS STAVROU", "Fournos Stavrou")).toBe(1);
    expect(similarity("Fournos Agia Paraskevi", "Artos Chalandriou")).toBeLessThan(0.85);
  });

  it("unknown candidate -> not_found; bad body -> validation_failed", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx(null, { candidate_id: "00000000-0000-4000-8000-000000000000" })))).toBe("not_found");
    expect(errCode(await handle(t.fnCtx(null, { candidate_id: "x" })))).toBe("validation_failed");
  });

  it("functions/candidate-dedupe/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "candidate-dedupe", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("candidate-dedupe"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
