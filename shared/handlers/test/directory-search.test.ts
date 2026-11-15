import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateResponse } from "../../core/src/index";
import { kit, ok, errCode, USERS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS, ROOT } from "../src/_lib/bundle";
import { areaPattern, BACKOFF_MS, CSV_ROWS, csvCovers, makeImpl, handle, osmCandidate, osmSelectors, overpassQuery, OVERPASS_URL, USER_AGENT, type FetchLike } from "../src/directory-search";
import { defineSystemFunction, orgOfSearch } from "../src/candidate-get";

const BAKERY = "10169ea8-bbde-567f-93b2-d5686ea70ef4";
const newSearch = (t: ReturnType<typeof kit>, area = "Chalandri", origin = "manual") =>
  t.db.prospect_search.insert({ requested_by: USERS.nikos, area_text: area, origin, status: "running", category_id: BAKERY } as any);
const entry = (fetch: FetchLike, sleeps: number[] = []) =>
  defineSystemFunction("directory-search", () => makeImpl({ fetch, sleep: async (ms) => { sleeps.push(ms); } }), (api, req) => orgOfSearch(api, req.search_id));
const OSM = { elements: [
  { type: "node", id: 1, lat: 38.0, lon: 23.8, tags: { shop: "bakery", name: "Φούρνος Βενέτη", "addr:postcode": "153 41", phone: "210 600 1234", website: "https://www.fournosveneti.gr" } },
  { type: "way", id: 2, center: { lat: 38.01, lon: 23.81 }, tags: { shop: "pastry", name: "Γλυκό", website: "https://www.google.com/maps/place/x" } },
  { type: "node", id: 3, lat: 38.02, lon: 23.82, tags: { shop: "bakery" } },
] };
const reply = (status: number, body: unknown = {}) => ({ ok: status < 300, status, json: async () => body });

describe("fn:directory-search (REQ-PRS-007, OPEN-05)", () => {
  it("the inlined CSV equals contracts/seed/prospect_list_chalandri_bakeries.json", () => {
    const seed = JSON.parse(readFileSync(join(ROOT, "spec/contracts/seed/prospect_list_chalandri_bakeries.json"), "utf8")) as Array<Record<string, unknown>>;
    expect(CSV_ROWS).toEqual(seed.map(({ expected, ...r }) => r));
  });

  it("CSV fallback: the seeded list fills a Chalandri search with 18 candidates, once (cached per search)", async () => {
    const t = kit();
    const s = await newSearch(t);
    const fetch: FetchLike = async () => { throw new Error("no network in the CSV path"); };
    const r = ok(await entry(fetch)(t.fnCtx(null, { search_id: s.id, caller: { user_id: USERS.thanasis } })));
    expect(r).toEqual({ candidates_created: 18 });
    expect(validateResponse("directory-search", r).ok).toBe(true);
    const rows = await t.db.candidate.all({ search_id: s.id });
    expect(rows.every((c) => c.status === "new" && c.external_source === "csv" && c.external_ref?.startsWith("prospect_list_chalandri_bakeries#"))).toBe(true);
    expect(ok(await entry(fetch)(t.fnCtx(null, { search_id: s.id })))).toEqual({ candidates_created: 0 });
  });

  it("csvCovers: Latin, Greek and postal-code mentions of Chalandri", () => {
    for (const a of ["Chalandri", "Halandri center", "Χαλάνδρι", "Δήμος Χαλανδρίου", "152 32", "15234"]) expect(csvCovers(a)).toBe(true);
    for (const a of ["Marousi", "Αγία Παρασκευή", "10673"]) expect(csvCovers(a)).toBe(false);
  });

  it("Overpass elsewhere: User-Agent, retry with backoff on 502, maps-host websites dropped, unnamed skipped", async () => {
    const t = kit();
    const s = await newSearch(t, "Αγία Παρασκευή");
    const calls: Array<{ url: string; init: any }> = [];
    let n = 0;
    const fetch: FetchLike = async (url, init) => { calls.push({ url, init }); return ++n === 1 ? reply(502) : reply(200, OSM); };
    const sleeps: number[] = [];
    expect(ok(await entry(fetch, sleeps)(t.fnCtx(null, { search_id: s.id })))).toEqual({ candidates_created: 2 });
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([BACKOFF_MS[0]]);
    expect(calls[0]!.url).toBe(OVERPASS_URL);
    expect(calls[0]!.init.headers["User-Agent"]).toBe(USER_AGENT);
    expect(decodeURIComponent(String(calls[0]!.init.body))).toContain(`nwr["shop"~"^(bakery|pastry)$"](area.a);`);
    const rows = await t.db.candidate.all({ search_id: s.id }, { orderBy: [{ column: "external_ref", direction: "asc" }] });
    expect(rows.map((r) => [r.business_name, r.external_ref, r.postal_code, r.phone, r.website, r.external_source])).toEqual([
      ["Φούρνος Βενέτη", "osm:node/1", null, "+302106001234", "https://www.fournosveneti.gr", "directory"],
      ["Γλυκό", "osm:way/2", null, null, null, "directory"],
    ]);
    expect(rows[1]!.lat).toBe(38.01);
  });

  it("Overpass down: upstream_failed after the retries and the search is marked failed", async () => {
    const t = kit();
    const s = await newSearch(t, "Marousi");
    const sleeps: number[] = [];
    const out = await entry(async () => reply(504), sleeps)(t.fnCtx(null, { search_id: s.id }));
    expect(errCode(out)).toBe("upstream_failed");
    expect(sleeps).toEqual(BACKOFF_MS);
    expect((await t.db.prospect_search.get(s.id))!.status).toBe("failed");
    expect(errCode(await entry(async () => reply(400))(t.fnCtx(null, { search_id: s.id })))).toBe("upstream_failed");
  });

  it("global MERC_PROSPECT_SOURCE=overpass forces Overpass even for Chalandri; unknown search -> not_found", async () => {
    const t = kit({ globals: { MERC_PROSPECT_SOURCE: "overpass" } });
    const s = await newSearch(t, "Chalandri");
    let called = 0;
    const out = ok(await entry(async () => { called++; return reply(200, OSM); })({ ...t.fnCtx(null, { search_id: s.id }) }));
    expect(called).toBe(1);
    expect(out.candidates_created).toBe(2);
    expect(errCode(await handle(t.fnCtx(null, { search_id: "00000000-0000-4000-8000-000000000000" })))).toBe("not_found");
    expect(errCode(await handle(t.fnCtx(null, {})))).toBe("validation_failed");
  });

  it("query building: category selectors and accent-insensitive Greek area names", () => {
    expect(osmSelectors(["Café"])).toEqual([`nwr["amenity"="cafe"]`]);
    expect(osmSelectors(["Αρτοποιείο"])).toEqual([`nwr["shop"~"^(bakery|pastry)$"]`]);
    expect(osmSelectors([])).toHaveLength(2);
    expect(areaPattern("Χαλάνδρι")).toBe("χ[αά]λ[αά]νδρ[ιίϊΐ]");
    expect(areaPattern('Ag"ia]')).toBe("ag ia");
    const q = overpassQuery("Marousi", ["Bakery"]);
    expect(q).toContain(`[~"^name(:el|:en)?$"~"marousi",i]->.a;`);
    expect(q).toMatch(/^\[out:json\]\[timeout:20\];/);
    expect(osmCandidate({ type: "node", id: 9, tags: {} })).toBeNull();
  });

  it("functions/directory-search/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "directory-search", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("directory-search"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
