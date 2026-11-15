// fn:search-finalize (contracts/functions/search-finalize.json, REQ-PRS-001). Last procedure step.
// Counts the search's candidates, closes the search and pushes candidates.ready to the requester (rep:{id}).
// Without a service account the push is a logged no-op (shared/live) and the app polls candidates-list.
import type { Db, FunctionContext, Impl, Principal, Row } from "../../core/src/index";
import { push, repChannel, type ApiLike, type Logger, type PushResult } from "../../live/src/index";
import { defineSystemFunction, orgOfSearch } from "./candidate-get";

export interface FinalizeDeps { api?: ApiLike | null; log?: Logger; now?: () => number }

export async function finalizeSearch(db: Db, search: Row<"prospect_search">, deps: FinalizeDeps = {}): Promise<{ found: number; duplicates: number; scored: number; push: PushResult }> {
  const cands = await db.candidate.all({ search_id: search.id });
  const ids = cands.map((c) => c.id);
  const scoredIds = new Set((ids.length ? await db.candidate_score.all({ candidate_id: ids }) : []).map((s) => s.candidate_id));
  const found = cands.length;
  const duplicates = cands.filter((c) => c.status === "duplicate").length;
  const scored = cands.filter((c) => scoredIds.has(c.id)).length;
  await db.prospect_search.update(search.id, { status: "done", found_count: found, duplicate_count: duplicates });
  const r = await push({ api: deps.api ?? null }, "candidates.ready", { search_id: search.id, found, duplicates, scored }, repChannel(search.requested_by), { log: deps.log, now: deps.now });
  return { found, duplicates, scored, push: r };
}

export function makeImpl(deps: FinalizeDeps = {}): Impl<"search-finalize", Principal> {
  return async ({ req, db }) => {
    const search = await db.prospect_search.require(req.search_id);
    const { found, duplicates, scored } = await finalizeSearch(db, search, deps);
    return { found, duplicates, scored };
  };
}
export const impl = makeImpl();

/** Wonderful Function entry. context.api exists only when the function has a service account. */
export const handle = defineSystemFunction("search-finalize", (c: FunctionContext) => makeImpl({ api: (c as { api?: ApiLike }).api ?? null }), (api, req) => orgOfSearch(api, req.search_id));
