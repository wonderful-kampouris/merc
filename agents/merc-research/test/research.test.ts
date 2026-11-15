// merc-research tools: same shared handlers as fn:candidate-get / fn:dossier-save, values injected from code.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { kit, ok, errCode, USERS } from "../../../shared/handlers/src/_lib/testkit";
import { getCandidate, htmlToText, lookupCompany, sameSite, saveDossier, scrapeWebsite, KV_CANDIDATE, type FetchLike, type ToolDeps } from "../lib/research";

const PAGE = `<html><head><style>.x{}</style><script>var a=1</script></head><body><h1>Bakery Elia</h1>
<p>Sourdough &amp; croissants</p><ul><li>Koulouri 0,80&euro;</li><li>We serve BlueBean Roasters espresso</li></ul></body></html>`;

function fakeFetch(routes: Record<string, { status?: number; body: string }>, calls: Array<{ url: string; init?: any }> = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    const r = routes[url];
    if (!r) throw new Error(`getaddrinfo ENOTFOUND ${url}`);
    const status = r.status ?? 200;
    return { ok: status < 400, status, text: async () => r.body, json: async () => JSON.parse(r.body) };
  };
}

async function setup(opts: { website?: string | null; vat?: string | null; secrets?: Record<string, unknown>; routes?: Record<string, { status?: number; body: string }> } = {}) {
  const t = kit({ secrets: opts.secrets ?? {} });
  const s = await t.db.prospect_search.insert({ requested_by: USERS.nikos, area_text: "Chalandri", origin: "manual", status: "running" } as any);
  const c = await t.db.candidate.insert({ search_id: s.id, business_name: "Bakery Elia", website: opts.website === undefined ? "https://bakeryelia.example.gr" : opts.website, vat_number: opts.vat ?? null, postal_code: "15233", external_source: "csv", status: "new" } as any);
  const kv = new Map<string, unknown>();
  const calls: Array<{ url: string; init?: any }> = [];
  const deps: ToolDeps = {
    tables: t.tables, secrets: t.platform.secrets, globals: t.platform.globals,
    kv: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    metadata: { contextType: "task", contextId: "task-123", workspaceId: "ws-test" },
    fetch: fakeFetch(opts.routes ?? { "https://bakeryelia.example.gr": { body: PAGE } }, calls),
  };
  return { t, c, deps, kv, calls };
}

describe("get_candidate -> fn:candidate-get", () => {
  it("loads the candidate through the shared handler and remembers it in code", async () => {
    const { c, deps, kv } = await setup();
    const r = ok(await getCandidate(deps, c.id)) as any;
    expect(r.candidate.business_name).toBe("Bakery Elia");
    expect(r.website).toBe("https://bakeryelia.example.gr");
    expect((kv.get(KV_CANDIDATE) as any).id).toBe(c.id);
  });
  it("unknown candidate -> not_found, nothing remembered", async () => {
    const { deps, kv } = await setup();
    expect(errCode(await getCandidate(deps, "00000000-0000-4000-8000-000000000000"))).toBe("not_found");
    expect(kv.has(KV_CANDIDATE)).toBe(false);
  });
});

describe("scrape_website (REQ-PRS-005)", () => {
  it("reads the shop's own site as text with source_url and retrieved_at", async () => {
    const { c, deps } = await setup();
    await getCandidate(deps, c.id);
    const r = (await scrapeWebsite(deps, "https://bakeryelia.example.gr")) as any;
    expect(r.via).toBe("fetch");
    expect(r.source_url).toBe("https://bakeryelia.example.gr");
    expect(r.content).toContain("Sourdough & croissants");
    expect(r.content).toContain("Koulouri 0,80€");
    expect(r.content).not.toContain("var a");
    expect(Number.isNaN(Date.parse(r.retrieved_at))).toBe(false);
  });
  it("refuses maps and review platforms before any fetch", async () => {
    const { deps, calls } = await setup();
    expect(errCode(await scrapeWebsite(deps, "https://www.google.com/maps/place/Bakery+Elia"))).toBe("invalid");
    expect(errCode(await scrapeWebsite(deps, "https://www.tripadvisor.com/Restaurant_Review-x"))).toBe("invalid");
    expect(calls).toHaveLength(0);
  });
  it("refuses other sites than the loaded candidate's own website", async () => {
    const { c, deps, calls } = await setup();
    await getCandidate(deps, c.id);
    expect(errCode(await scrapeWebsite(deps, "https://competitor.example.gr"))).toBe("invalid");
    expect(calls).toHaveLength(0);
    expect(sameSite("https://shop.bakeryelia.example.gr/menu", "https://www.bakeryelia.example.gr")).toBe(true);
  });
  it("unreachable site -> upstream_failed (the agent then saves 'website unreachable')", async () => {
    const { c, deps } = await setup({ routes: {} });
    await getCandidate(deps, c.id);
    expect(errCode(await scrapeWebsite(deps, "https://bakeryelia.example.gr"))).toBe("upstream_failed");
  });
  it("uses Firecrawl with the secret by name when FIRECRAWL_API_KEY exists", async () => {
    const { c, deps, calls } = await setup({ secrets: { FIRECRAWL_API_KEY: "x" }, routes: { "https://api.firecrawl.dev/v1/scrape": { body: JSON.stringify({ data: { markdown: "# Bakery Elia\nSourdough" } }) } } });
    await getCandidate(deps, c.id);
    const r = (await scrapeWebsite(deps, "https://bakeryelia.example.gr")) as any;
    expect(r.via).toBe("firecrawl");
    expect(calls[0]!.init.secretName).toBe("FIRECRAWL_API_KEY");
    expect(JSON.stringify(calls[0]!.init)).not.toContain('"x"');
  });
  it("htmlToText drops markup", () => expect(htmlToText("<p>a</p><p>b&nbsp;c</p>")).toBe("a\nb c"));
});

describe("lookup_company (registry)", () => {
  it("blocked_by_policy naming the secret while DIRECTORY_API_KEY is unset", async () => {
    const { deps } = await setup({ vat: "800039595" });
    const r = (await lookupCompany(deps, "800039595", null)) as any;
    expect(r.error.code).toBe("blocked_by_policy");
    expect(r.error.details.missing).toBe("DIRECTORY_API_KEY");
  });
  it("queries GEMI by VAT with the secret by name and returns sourced companies", async () => {
    const url = "https://opendata-api.businessportal.gr/api/opendata/v1/companies?afm=800039595";
    const { c, deps, calls } = await setup({ website: null, vat: "800039595", secrets: { DIRECTORY_API_KEY: "k" }, routes: { [url]: { body: JSON.stringify({ searchResults: [{ arGemi: "123456701000", coNameEl: "ΑΡΤΟΣ ΧΑΛΑΝΔΡΙΟΥ ΙΚΕ", afm: "800039595", zipCode: "15231", city: "ΧΑΛΑΝΔΡΙ" }] }) } } });
    await getCandidate(deps, c.id);
    const r = (await lookupCompany(deps, null, null)) as any;
    expect(calls[0]!.url).toBe(url);
    expect(calls[0]!.init.secretName).toBe("DIRECTORY_API_KEY");
    expect(r.found).toBe(1);
    expect(r.companies[0].source_url).toBe("https://publicity.businessportal.gr/company/123456701000");
  });
});

describe("save_dossier -> fn:dossier-save (REQ-PRS-003)", () => {
  it("saves with candidate_id from code and research_task_id from the task context; maps facts rejected", async () => {
    const { t, c, deps } = await setup();
    await getCandidate(deps, c.id);
    const r = ok(await saveDossier(deps, { summary: "Artisan bakery", price_level: "mid", facts: [
      { fact_type: "product", value: "Sourdough, croissants", source_url: "https://bakeryelia.example.gr" },
      { fact_type: "product", value: "x", source_url: "https://www.google.com/maps/place/x" },
    ] })) as any;
    expect(r).toEqual({ dossier_id: expect.any(String), facts_saved: 1, facts_rejected: 1 });
    const d = await t.db.dossier.get(r.dossier_id);
    expect(d!.candidate_id).toBe(c.id);
    expect(d!.research_task_id).toBe("task-123");
    expect((await t.db.candidate.get(c.id))!.status).toBe("researched");
  });
  it("a model-supplied candidate_id that differs from the loaded one is refused", async () => {
    const { c, deps } = await setup();
    await getCandidate(deps, c.id);
    expect(errCode(await saveDossier(deps, { candidate_id: "00000000-0000-4000-8000-000000000000", summary: "x", facts: [] }))).toBe("invalid");
  });
  it("no website: registry-only dossier with summary 'no website'", async () => {
    const { t, c, deps } = await setup({ website: null });
    await getCandidate(deps, c.id);
    expect(errCode(await scrapeWebsite(deps, "https://anything.example.gr"))).toBe("invalid");
    const r = ok(await saveDossier(deps, { summary: "no website", facts: [] })) as any;
    expect((await t.db.dossier.get(r.dossier_id))!.summary).toBe("no website");
  });
});

describe("bundle", () => {
  it("lib/handlers.gen.js is fresh against shared/handlers", () => {
    execFileSync("node", [join(__dirname, "../scripts/bundle-handlers.mjs"), "--check"], { stdio: "pipe" });
  });
});

describe("normalize fallback (tool runtime has no String.prototype.normalize)", () => {
  it("decomposes Greek tonos and Latin accents so the shared normName works the same", async () => {
    const { decompose, installNormalizeFallback } = await import("../lib/normalize-polyfill");
    const strip = (s: string) => decompose(s).replace(/[̀-ͯ]/g, "");
    expect(strip("Φούρνος Σταύρου")).toBe("Φουρνος Σταυρου");
    expect(strip("Café Míltos ΐ")).toBe("Cafe Miltos ι");
    for (const ch of "àéïõüçñάέήίόύώϊϋΐΰ") expect(decompose(ch)).toBe(ch.normalize("NFD"));
    expect(installNormalizeFallback(String)).toBe(false); // a working runtime normalize is left untouched
    const fake = { prototype: {} as any };
    expect(installNormalizeFallback(fake)).toBe(true);
    expect(fake.prototype.normalize.call("Σταύρου", "NFD").replace(/[̀-ͯ]/g, "")).toBe("Σταυρου");
  });
});
