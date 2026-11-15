// fn:prospect-search (contracts/functions/prospect-search.json, REQ-PRS-001). App and buddy (find_shops).
// Creates the prospect_search and starts the prospecting pipeline:
//   1. procedure prospecting-pipeline through context.automations.invoke, when global variable
//      MERC_PROSPECTING_PROCEDURE_ID names a published procedure (directory -> dedupe -> research -> score -> finalize);
//   2. otherwise (procedure not deployed yet, or invoke fails) the inline fallback chain: directory search and dedupe
//      for every candidate, then scoring until a time budget is used up, then finalize (push candidates.ready) when
//      every non-duplicate is scored. Inline scoring has no research dossier (merc-research runs only in the procedure).
import { defineFunction, globalString, invalid, isMercError, type Db, type FunctionContext, type Impl, type PlatformLike, type Principal, type Row } from "../../core/src/index";
import type { ModelFactory } from "../../llm/src/index";
import type { ApiLike } from "../../live/src/index";
import { dedupeCandidate, normName } from "./candidate-dedupe";
import { runDirectorySearch, runtimeFetch, type FetchLike } from "./directory-search";
import { scoreCandidate } from "./candidate-score";
import { finalizeSearch } from "./search-finalize";

export const GLOBAL_PIPELINE_ID = "MERC_PROSPECTING_PROCEDURE_ID";
/** Inline scoring stops after this much time so the call stays under the 30 s function timeout. */
export const INLINE_BUDGET_MS = 18_000;

export interface AutomationsLike { invoke(o: { automationId: string; input: unknown }): Promise<{ runId?: string; status?: string } | null | undefined> }
export interface PipelineDeps { automations?: AutomationsLike | null; api?: ApiLike | null; fetch: FetchLike; model?: ModelFactory; now?: () => number; sleep?: (ms: number) => Promise<void>; budgetMs?: number }

const log = (m: string) => console.log(`[prospecting] ${m}`);

/** Inline fallback chain. Returns the search status: done (finalized) | running (left for later) | failed. */
export async function runInline(db: Db, me: Principal, search: Row<"prospect_search">, platform: PlatformLike, deps: PipelineDeps, opts: { directory: boolean }): Promise<string> {
  const now = deps.now ?? Date.now;
  const t0 = now();
  if (opts.directory) {
    try { await runDirectorySearch(db, search, platform, deps); }
    catch (e) { log(`directory search failed: ${(e as Error)?.message ?? e}`); return "failed"; }
  }
  for (const c of await db.candidate.all({ search_id: search.id, status: "new" })) await dedupeCandidate(db, c);
  for (const c of await db.candidate.all({ search_id: search.id, status: ["new", "researched"] })) {
    if (now() - t0 > (deps.budgetMs ?? INLINE_BUDGET_MS)) { log(`inline budget used up; search ${search.id} stays running`); break; }
    try { await scoreCandidate(db, me, c, deps); }
    catch (e) { log(`scoring ${c.id} failed: ${isMercError(e) ? `${e.code} ${e.message}` : String(e)}`); }
  }
  const left = await db.candidate.count({ search_id: search.id, status: ["new", "researched"] });
  if (left > 0) return "running";
  await finalizeSearch(db, (await db.prospect_search.require(search.id)), { api: deps.api, now: deps.now });
  return "done";
}

/** Start the pipeline for a search: the procedure when configured, else the inline chain. */
export async function startPipeline(db: Db, me: Principal, search: Row<"prospect_search">, platform: PlatformLike, deps: PipelineDeps, opts: { directory: boolean }): Promise<string> {
  const procedureId = globalString(platform, GLOBAL_PIPELINE_ID);
  if (procedureId && deps.automations && typeof deps.automations.invoke === "function") {
    try {
      const r = await deps.automations.invoke({ automationId: procedureId, input: { search_id: search.id } });
      if (r?.runId) await db.prospect_search.update(search.id, { procedure_run_id: String(r.runId) });
      return "running";
    } catch (e) {
      log(`procedure ${procedureId} could not start (${(e as Error)?.message ?? e}); running the inline chain`);
    }
  }
  const status = await runInline(db, me, search, platform, deps, opts);
  if (status === "failed") await db.prospect_search.update(search.id, { status: "failed" });
  return status;
}

/** category_text -> account_category id by name (case/accent-insensitive, either contains the other). */
const stem = (s: string) => s.split(" ").map((w) => w.replace(/ies$/, "y").replace(/(?<=[a-z]{3})s$/, "")).join(" ");
export async function resolveCategory(db: Db, text: string | null | undefined): Promise<string | null> {
  const t = stem(normName(text));
  if (!t) return null;
  const cats = await db.account_category.all();
  const hit = cats.find((c) => stem(normName(c.name)) === t) ?? cats.find((c) => { const n = stem(normName(c.name)); return n.length >= 3 && (t.includes(n) || n.includes(t)); });
  return hit?.id ?? null;
}

export function makeImpl(deps: PipelineDeps): Impl<"prospect-search"> {
  return async ({ req, db, me, platform }) => {
    const area = req.area_text.trim();
    if (!area) throw invalid("area_text is empty");
    let categoryId = req.category_id ?? null;
    if (categoryId && !(await db.account_category.get(categoryId))) throw invalid("unknown category_id", { category_id: categoryId });
    if (!categoryId) categoryId = await resolveCategory(db, req.category_text);
    const search = await db.prospect_search.insert({ requested_by: me.id, category_id: categoryId, area_text: area, origin: req.origin, status: "running" } as any);
    const status = await startPipeline(db, me, search, platform, deps, { directory: true });
    return { search_id: search.id, status };
  };
}

/** Deps from the runtime context: context.automations (procedures), context.api (push, service account only), fetch. */
export const depsOf = (c: unknown): PipelineDeps => ({
  automations: ((c as { automations?: AutomationsLike }).automations ?? null),
  api: ((c as { api?: ApiLike }).api ?? null),
  fetch: runtimeFetch,
});
/** Same impl for the buddy tool (no context.automations/api there: inline chain, push skipped). */
export const impl = makeImpl({ fetch: runtimeFetch });

/** Wonderful Function entry (functions/prospect-search/index.ts). */
export const handle = (context: FunctionContext) => defineFunction("prospect-search", makeImpl(depsOf(context)))(context);
