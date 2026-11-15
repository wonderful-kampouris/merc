// fn:candidates-list (contracts/functions/candidates-list.json). App prospecting screen and buddy list_new_shops.
// Candidates the caller may see (prospects.read: requested the search, assigned, territory, team), as CandidateCards,
// best score first (unscored last), then by name. Optional filters: search_id, status. Paged (default 20, max 100).
import { defineFunction, invalid, type Impl, type Row } from "../../core/src/index";
import { canSeeCandidate, candidateCard } from "./candidate-get";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export const impl: Impl<"candidates-list"> = async ({ req, db, me }) => {
  const page = Math.max(1, req.page ?? 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, req.limit ?? DEFAULT_LIMIT));
  const searches = req.search_id ? [await db.prospect_search.get(req.search_id)].filter((s): s is Row<"prospect_search"> => !!s) : await db.prospect_search.all();
  if (req.search_id && !searches.length) throw invalid("unknown search_id", { search_id: req.search_id });
  const byId = new Map(searches.map((s) => [s.id, s]));
  const rows = byId.size ? await db.candidate.all({ search_id: [...byId.keys()], ...(req.status ? { status: req.status as Row<"candidate">["status"] } : {}) }) : [];
  const visible: Row<"candidate">[] = [];
  for (const c of rows) if (await canSeeCandidate(db, me, c, byId.get(c.search_id)!)) visible.push(c);
  const cards = await Promise.all(visible.map((c) => candidateCard(db, c)));
  cards.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.business_name.localeCompare(b.business_name) || a.candidate_id.localeCompare(b.candidate_id));
  return { items: cards.slice((page - 1) * limit, page * limit), page: { page, limit, total: cards.length } };
};

/** Wonderful Function entry (functions/candidates-list/index.ts). */
export const handle = defineFunction("candidates-list", impl);
