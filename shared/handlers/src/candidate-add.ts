// fn:candidate-add (contracts/functions/candidate-add.json, REQ-PRS-008). Buddy add_candidate and the app.
// "New bakery next to Miltos": one candidate (external_source rep) in its own prospect_search (origin single_add).
// The location hint is resolved to a postal code (a 5-digit code in the hint, or a visible account named in it).
// Dedupe runs at once; a duplicate returns the matched account and closes the search. A new shop goes into the
// prospecting pipeline (procedure, or the inline chain) for research and scoring.
import { canSeeAccount, defineFunction, invalid, listAccounts, type Db, type FunctionContext, type Impl, type Principal } from "../../core/src/index";
import { accountRef } from "./candidate-get";
import { dedupeCandidate, normDomain, normName, normPhone } from "./candidate-dedupe";
import { depsOf, startPipeline, type PipelineDeps } from "./prospect-search";
import { finalizeSearch } from "./search-finalize";
import { runtimeFetch } from "./directory-search";

/** Words too generic to identify an account in a location hint. */
const GENERIC = new Set(["cafe", "kafe", "coffee", "bakery", "fournos", "artos", "mini", "market", "bistro", "taverna", "hotel", "restaurant", "corner", "next", "near", "the", "and", "bar", "deli", "patisserie", "brunch", "view"]);

export interface Located { postal_code: string | null; lat: number | null; lng: number | null; near_account_id: string | null }

export async function resolveLocation(db: Db, me: Principal, hint: string | null | undefined): Promise<Located> {
  const none: Located = { postal_code: null, lat: null, lng: null, near_account_id: null };
  const h = String(hint ?? "").trim();
  if (!h) return none;
  const pc = /\b(\d{3})\s?(\d{2})\b/.exec(h);
  if (pc) {
    const code = `${pc[1]}${pc[2]}`;
    const pa = await db.postal_area.get(code);   // candidate.postal_code references postal_area: unknown codes stay null
    if (pa) return { postal_code: code, lat: pa.lat ?? null, lng: pa.lng ?? null, near_account_id: null };
  }
  const words = new Set(normName(h).split(" "));
  const accounts = (await listAccounts(db, me, {}, { limit: 1000 })).items;
  const hit = accounts.find((a) => normName(a.name).split(" ").some((w) => w.length >= 4 && !GENERIC.has(w) && words.has(w)));
  return hit ? { postal_code: hit.postal_code ?? null, lat: hit.lat ?? null, lng: hit.lng ?? null, near_account_id: hit.id } : none;
}

export function makeImpl(deps: PipelineDeps): Impl<"candidate-add"> {
  return async ({ req, db, me, platform }) => {
    const name = req.business_name.trim();
    if (!name) throw invalid("business_name is empty");
    const loc = await resolveLocation(db, me, req.location_hint);
    const website = req.website?.trim() || null;
    if (website && !normDomain(website)) throw invalid("website is not a valid address", { website });
    const search = await db.prospect_search.insert({ requested_by: me.id, category_id: null, area_text: req.location_hint?.trim() || name, origin: "single_add", status: "running" } as any);
    const candidate = await db.candidate.insert({
      search_id: search.id, business_name: name, vat_number: null, street: null,
      postal_code: loc.postal_code, lat: loc.lat, lng: loc.lng,
      phone: normPhone(req.phone) ?? (req.phone?.trim() || null), website,
      external_source: "rep", external_ref: null, status: "new",
      assigned_rep_id: me.role === "rep" ? me.id : null,
    } as any);
    const d = await dedupeCandidate(db, candidate);
    let duplicate_of = null;
    if (d.duplicate) {
      const acc = d.matched_account_id ? await db.account.get(d.matched_account_id) : null;
      duplicate_of = acc && canSeeAccount(me, acc) ? accountRef(acc) : null;
      await finalizeSearch(db, search, { api: deps.api, now: deps.now });
    } else {
      await startPipeline(db, me, search, platform, deps, { directory: false });
    }
    return { candidate_id: candidate.id, search_id: search.id, duplicate_of };
  };
}
export const impl = makeImpl({ fetch: runtimeFetch });

/** Wonderful Function entry (functions/candidate-add/index.ts). */
export const handle = (context: FunctionContext) => defineFunction("candidate-add", makeImpl(depsOf(context)))(context);
