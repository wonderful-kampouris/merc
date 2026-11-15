// fn:directory-search (contracts/functions/directory-search.json, REQ-PRS-007, OPEN-05/OPEN-18). Procedure step.
// Fills a prospect_search with candidates from a business directory:
//   - csv:      the seeded list contracts/seed/prospect_list_chalandri_bakeries.json (inlined below; a test keeps it equal)
//   - overpass: OpenStreetMap Overpass API (spike S5: no key, User-Agent, retry with backoff on 429/502/503/504)
// Source choice: global variable MERC_PROSPECT_SOURCE = auto | csv | overpass (default auto). auto uses the CSV for
// list uploads and for areas the seeded list covers (Chalandri, 15231-15234), Overpass everywhere else.
// Idempotent per search: rows whose external_ref is already in the search are skipped (results cached per search).
import { globalString, invalid, MercError, type Db, type FunctionContext, type Impl, type PlatformLike, type Principal, type Row } from "../../core/src/index";
import { defineSystemFunction, orgOfSearch } from "./candidate-get";
import { normDomain, normName, normPhone } from "./candidate-dedupe";
import { sourceProblem } from "./dossier-save";

export const GLOBAL_SOURCE = "MERC_PROSPECT_SOURCE";
export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
export const USER_AGENT = "merc-prospecting/0.1 (Merc field-sales CRM; hackathon Team Delta)";
export const CSV_SOURCE = "prospect_list_chalandri_bakeries";
export const CSV_POSTAL_CODES = ["15231", "15232", "15233", "15234"];
export const MAX_CANDIDATES = 60;

export interface CsvRow { business_name: string; vat_number: string | null; website: string | null; phone: string | null; postal_code: string | null; external_source: "csv" }
/** contracts/seed/prospect_list_chalandri_bakeries.json without the `expected` test column. */
export const CSV_ROWS: CsvRow[] = [
  { business_name: "Artos Chalandriou", vat_number: "800039595", website: null, phone: null, postal_code: "15231", external_source: "csv" },
  { business_name: "Zymi Bakery", vat_number: null, website: "https://zymi.example.gr", phone: null, postal_code: "15232", external_source: "csv" },
  { business_name: "Pita & Psomi", vat_number: null, website: null, phone: "+302106000959", postal_code: "15233", external_source: "csv" },
  { business_name: "FOURNOS STAVROU", vat_number: null, website: null, phone: null, postal_code: "15234", external_source: "csv" },
  { business_name: "Glykia Gonia Bakery", vat_number: "800071271", website: null, phone: null, postal_code: "15231", external_source: "csv" },
  { business_name: "Fournos Agia Paraskevi", vat_number: "900000000", website: "https://fournosagiaparaskevi.example.gr", phone: "+302106800000", postal_code: "15231", external_source: "csv" },
  { business_name: "Psomi tis Geitonias", vat_number: "900000101", website: "https://psomitisgeitonias.example.gr", phone: "+302106800031", postal_code: "15232", external_source: "csv" },
  { business_name: "Bakery Elia", vat_number: "900000202", website: "https://bakeryelia.example.gr", phone: "+302106800062", postal_code: "15233", external_source: "csv" },
  { business_name: "Oven 15233", vat_number: "900000303", website: "https://oven15233.example.gr", phone: "+302106800093", postal_code: "15234", external_source: "csv" },
  { business_name: "Mylos Bread Co", vat_number: "900000404", website: null, phone: "+302106800124", postal_code: "15231", external_source: "csv" },
  { business_name: "Prozymi Artisan", vat_number: "900000505", website: "https://prozymiartisan.example.gr", phone: "+302106800155", postal_code: "15232", external_source: "csv" },
  { business_name: "Koulouri Corner", vat_number: "900000606", website: "https://koulouricorner.example.gr", phone: "+302106800186", postal_code: "15233", external_source: "csv" },
  { business_name: "Fournos Melissia", vat_number: "900000707", website: "https://fournosmelissia.example.gr", phone: "+302106800217", postal_code: "15234", external_source: "csv" },
  { business_name: "Sitari Bakehouse", vat_number: "900000808", website: "https://sitaribakehouse.example.gr", phone: "+302106800248", postal_code: "15231", external_source: "csv" },
  { business_name: "Chalandri Sourdough", vat_number: "900000909", website: null, phone: "+302106800279", postal_code: "15232", external_source: "csv" },
  { business_name: "Bougatsa Thessaloniki Chalandri", vat_number: "900001010", website: "https://bougatsathessalonikichalandri.example.gr", phone: "+302106800310", postal_code: "15233", external_source: "csv" },
  { business_name: "Glykes Stigmes Patisserie", vat_number: "900001111", website: "https://glykesstigmespatisserie.example.gr", phone: "+302106800341", postal_code: "15234", external_source: "csv" },
  { business_name: "Ble Fournos", vat_number: "900001212", website: "https://blefournos.example.gr", phone: "+302106800372", postal_code: "15231", external_source: "csv" },
];

export type CandidateDraft = { business_name: string; vat_number: string | null; street: string | null; postal_code: string | null; lat: number | null; lng: number | null; phone: string | null; website: string | null; external_source: "csv" | "directory"; external_ref: string };

export const csvCandidates = (): CandidateDraft[] =>
  CSV_ROWS.map((r, i) => ({ business_name: r.business_name, vat_number: r.vat_number, street: null, postal_code: r.postal_code, lat: null, lng: null, phone: r.phone, website: r.website, external_source: "csv", external_ref: `${CSV_SOURCE}#${i + 1}` }));

/** Does the seeded list cover this area? (Chalandri in Latin or Greek, or one of its postal codes.) */
export function csvCovers(area: string | null | undefined): boolean {
  const n = normName(area);
  if (/\b(c?halandr\w*)\b/.test(n)) return true;
  const digits = String(area ?? "").replace(/(\d{3})\s(\d{2})/g, "$1$2");
  return CSV_POSTAL_CODES.some((pc) => digits.includes(pc));
}

export type SourceMode = "auto" | "csv" | "overpass";
export const sourceMode = (v: string | null): SourceMode => (v === "csv" || v === "overpass" ? v : "auto");

// ---- Overpass
/** OSM selectors for the category names (account_category.name or free text). Unknown -> bakery/pastry + cafe. */
export function osmSelectors(categories: string[]): string[] {
  const out = new Set<string>();
  for (const c of categories.map((x) => normName(x))) {
    if (/bak|fourn|artopoi|pastr|patis|zacharopl/.test(c)) out.add(`nwr["shop"~"^(bakery|pastry)$"]`);
    if (/caf|kafe|coffee/.test(c)) out.add(`nwr["amenity"="cafe"]`);
    if (/restaur|estiator|tavern/.test(c)) out.add(`nwr["amenity"="restaurant"]`);
    if (/hotel|xenodoch/.test(c)) out.add(`nwr["tourism"="hotel"]`);
    if (/market|super|pantopol/.test(c)) out.add(`nwr["shop"~"^(convenience|supermarket)$"]`);
  }
  return out.size ? [...out] : [`nwr["shop"~"^(bakery|pastry)$"]`, `nwr["amenity"="cafe"]`];
}

const ACCENTS: Record<string, string> = { α: "[αά]", ε: "[εέ]", η: "[ηή]", ι: "[ιίϊΐ]", ο: "[οό]", υ: "[υύϋΰ]", ω: "[ωώ]" };
/** Accent-insensitive regex for an area name (Greek vowels match with or without tonos). Only letters/digits/space/-. */
export function areaPattern(area: string): string {
  const clean = area.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N} -]/gu, " ").trim().replace(/\s+/g, " ");
  let out = "";
  for (const ch of clean) out += ACCENTS[ch] ?? ch;
  return out;
}

export function overpassQuery(area: string, categories: string[], limit = MAX_CANDIDATES): string {
  const p = areaPattern(area);
  if (!p) throw invalid("area_text has no letters or digits to search for");
  const sel = osmSelectors(categories).map((s) => `${s}(area.a);`).join("");
  return `[out:json][timeout:20];area["boundary"="administrative"][~"^name(:el|:en)?$"~"${p}",i]->.a;(${sel});out center tags ${limit};`;
}

export interface OsmElement { type: string; id: number | string; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> }
export function osmCandidate(e: OsmElement): CandidateDraft | null {
  const t = e.tags ?? {};
  const name = (t.name ?? t["name:el"] ?? t["name:en"] ?? "").trim();
  if (!name) return null;
  const web = t.website ?? t["contact:website"] ?? null;
  const street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ") || null;
  const lat = e.lat ?? e.center?.lat ?? null, lng = e.lon ?? e.center?.lon ?? null;
  return {
    business_name: name, vat_number: null, street,
    postal_code: (t["addr:postcode"] ?? "").replace(/\s/g, "") || null,
    lat: typeof lat === "number" ? lat : null, lng: typeof lng === "number" ? lng : null,
    phone: normPhone(t.phone ?? t["contact:phone"] ?? null) ?? (t.phone ?? t["contact:phone"] ?? null),
    website: web && normDomain(web) && !sourceProblem(/^https?:\/\//i.test(web) ? web : `https://${web}`) ? web : null,
    external_source: "directory", external_ref: `osm:${e.type}/${e.id}`,
  };
}

export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text?(): Promise<string> }>;
export interface DirectoryDeps { fetch: FetchLike; sleep?: (ms: number) => Promise<void>; now?: () => number }
const RETRY = new Set([429, 502, 503, 504]);
export const BACKOFF_MS = [1500, 4000];

/** POST the query with retry/backoff; the whole call stays inside the 30 s function budget. */
export async function fetchOverpass(deps: DirectoryDeps, query: string): Promise<OsmElement[]> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const t0 = now();
  let last = "no attempt";
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (attempt > 0) { if (now() - t0 > 12_000) break; await sleep(BACKOFF_MS[attempt - 1]!); }
    try {
      const res = await deps.fetch(OVERPASS_URL, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: 20_000,
      });
      if (res.ok) {
        const j = (await res.json()) as { elements?: OsmElement[] };
        return Array.isArray(j?.elements) ? j.elements : [];
      }
      last = `HTTP ${res.status}`;
      if (!RETRY.has(res.status)) break;
    } catch (e) {
      last = String((e as Error)?.message ?? e);
    }
  }
  throw new MercError("upstream_failed", `Overpass directory search failed (${last}); retry later or use the CSV list`, { source: "overpass", last });
}

async function categoryNames(db: Db, search: Row<"prospect_search">): Promise<string[]> {
  if (search.category_id) { const c = await db.account_category.get(search.category_id); if (c) return [c.name]; }
  const icp = await db.icp_category.all();
  const cats = icp.length ? await db.account_category.all({ id: icp.map((x) => x.category_id) }) : [];
  return cats.map((c) => c.name);
}

/** Insert the directory rows of one search. Returns the number of candidates created. Marks the search failed on upstream errors. */
export async function runDirectorySearch(db: Db, search: Row<"prospect_search">, platform: PlatformLike, deps: DirectoryDeps): Promise<{ created: number; source: "csv" | "overpass" }> {
  const mode = sourceMode(globalString(platform, GLOBAL_SOURCE));
  const useCsv = mode === "csv" || (mode === "auto" && (search.origin === "list_upload" || csvCovers(search.area_text)));
  let rows: CandidateDraft[];
  if (useCsv) rows = csvCandidates();
  else {
    if (!search.area_text?.trim()) throw invalid("the search has no area_text for the directory");
    try {
      rows = (await fetchOverpass(deps, overpassQuery(search.area_text, await categoryNames(db, search)))).map(osmCandidate).filter((x): x is CandidateDraft => !!x);
    } catch (e) {
      await db.prospect_search.update(search.id, { status: "failed" });
      throw e;
    }
  }
  const have = new Set((await db.candidate.all({ search_id: search.id })).map((c) => c.external_ref).filter(Boolean));
  // candidate.postal_code references postal_area: codes the org does not know are kept out (lat/lng still locate the shop).
  const codes = [...new Set(rows.map((r) => r.postal_code).filter((x): x is string => !!x))];
  const known = new Set((codes.length ? await db.postal_area.all({ postal_code: codes }) : []).map((p) => p.postal_code));
  let created = 0;
  for (const r of rows.slice(0, MAX_CANDIDATES)) {
    if (have.has(r.external_ref)) continue;
    have.add(r.external_ref);
    await db.candidate.insert({ ...r, postal_code: r.postal_code && known.has(r.postal_code) ? r.postal_code : null, search_id: search.id, status: "new" } as any);
    created++;
  }
  return { created, source: useCsv ? "csv" : "overpass" };
}

export function makeImpl(deps: DirectoryDeps): Impl<"directory-search", Principal> {
  return async ({ req, db, platform }) => {
    const search = await db.prospect_search.require(req.search_id);
    return { candidates_created: (await runDirectorySearch(db, search, platform, deps)).created };
  };
}
export const runtimeFetch: FetchLike = (url, init) => (globalThis as any).fetch(url, init);
export const impl = makeImpl({ fetch: runtimeFetch });

/** Wonderful Function entry (functions/directory-search/index.ts). Caller: procedure prospecting-pipeline. */
export const handle = defineSystemFunction("directory-search", (_c: FunctionContext) => impl, (api, req) => orgOfSearch(api, req.search_id));
