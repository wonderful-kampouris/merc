// fn:candidate-get (contracts/functions/candidate-get.json): the shop merc-research is about to research.
// Also the shared prospecting helpers (WP-PRS-01): candidate scope, CandidateCard/DossierView builders, and the
// entry for procedure/research callers, which have no Merc user and run as the org's system principal.
//
// Candidates, scores and dossiers have no org_id column: a candidate belongs to the org of its prospect_search
// (org-scoped), so every candidate read goes through requireCandidate(), which checks the search is in the org.
import {
  contract, createDb, errorResult, forbidden, notFound, runAsSystem, validateRequest, visibleTerritoryIds, visibleUserIds,
  type Db, type FunctionContext, type FunctionSlug, type Impl, type Outcome, type PlatformLike, type Principal, type Row, type TablesApi,
} from "../../core/src/index";
import type { AccountRef, CandidateCard, DossierView, UserRef } from "../../core/src/generated/contracts/types";

/** The platform extras of a Function context, as @merc/core's entries pass them (secrets, globals, workspace). */
export function platformOf(c: { secrets?: unknown; globals?: unknown; metadata?: unknown }): PlatformLike {
  const ws = (c.metadata as { workspaceId?: unknown } | null | undefined)?.workspaceId;
  return { secrets: (c.secrets as PlatformLike["secrets"]) ?? null, globals: (c.globals as PlatformLike["globals"]) ?? null, workspaceId: typeof ws === "string" && ws ? ws : null };
}

// ---- org of a record (trusted derivation for system callers: the org comes from the row, never from a field)
export async function orgOfSearch(api: TablesApi, searchId: string): Promise<string> {
  const s = await createDb(api).prospect_search.get(searchId);
  if (!s) throw notFound("prospect_search not found", { id: searchId });
  return s.org_id;
}
export async function orgOfCandidate(api: TablesApi, candidateId: string): Promise<string> {
  const c = await createDb(api).candidate.get(candidateId);
  if (!c) throw notFound("candidate not found", { id: candidateId });
  return orgOfSearch(api, c.search_id);
}
export async function orgOfAccount(api: TablesApi, accountId: string): Promise<string> {
  const a = await createDb(api).account.get(accountId);
  if (!a) throw notFound("account not found", { id: accountId });
  return a.org_id;
}

/**
 * Entry for functions whose callers are procedure steps or the merc-research agent (gate null, no Merc user).
 * Validates the request, derives the org from the record it names, then runs the impl as that org's system
 * principal (caller "procedure") through @merc/core runAsSystem (response checked against the contract).
 */
export function defineSystemFunction<S extends FunctionSlug>(
  slug: S,
  makeImpl: (context: FunctionContext) => Impl<S, Principal>,
  orgOf: (api: TablesApi, req: any) => Promise<string>,
) {
  return async (context: FunctionContext): Promise<Outcome<S>> => {
    const body = context.data && typeof context.data === "object" && !Array.isArray(context.data) ? { ...(context.data as Record<string, unknown>) } : context.data ?? {};
    if (body && typeof body === "object") delete (body as Record<string, unknown>).caller;
    const v = validateRequest(slug, body, { coerce: contract(slug).method === "GET" });
    if (!v.ok) return { error: v.error };
    let orgId: string;
    try { orgId = await orgOf(context.tables, v.value); } catch (e) { return errorResult(e); }
    return runAsSystem(slug, makeImpl(context), { tables: context.tables, data: body, orgId, caller: "procedure", platform: platformOf(context) });
  };
}

// ---- scope
export async function territoryOfPostal(db: Db, postalCode: string | null | undefined): Promise<string | null> {
  if (!postalCode) return null;
  return (await db.territory_postal_code.findOne({ postal_code: postalCode }))?.territory_id ?? null;
}

/** prospects.* relations: owner (requested the search or is assigned), territory_member, team_manager. Admin/system: all. */
export async function canSeeCandidate(db: Db, me: Principal, c: Row<"candidate">, search: Row<"prospect_search">): Promise<boolean> {
  const users = visibleUserIds(me);
  if (users === null) return true;
  if (users.includes(search.requested_by)) return true;
  if (c.assigned_rep_id && users.includes(c.assigned_rep_id)) return true;
  const terr = visibleTerritoryIds(me) ?? [];
  const t = await territoryOfPostal(db, c.postal_code);
  return !!t && terr.includes(t);
}

/** Candidate by id: not_found if missing or of another org, forbidden if out of the caller's scope. */
export async function requireCandidate(db: Db, me: Principal, id: string): Promise<{ candidate: Row<"candidate">; search: Row<"prospect_search"> }> {
  const candidate = await db.candidate.get(id);
  const search = candidate ? await db.prospect_search.get(candidate.search_id) : null;
  if (!candidate || !search) throw notFound("candidate not found", { table: "candidate", id });
  if (!(await canSeeCandidate(db, me, candidate, search))) throw forbidden("candidate is outside your scope");
  return { candidate, search };
}

// ---- views
export const accountRef = (a: Row<"account">): AccountRef => ({ id: a.id, name: a.name, account_type: a.account_type as AccountRef["account_type"], postal_code: a.postal_code ?? null });
export const userRef = (u: Row<"app_user">): UserRef => ({ id: u.id, full_name: u.full_name, role: u.role_code as UserRef["role"] });

const iso = (v: unknown): string => {
  if (typeof v === "number") return new Date(v).toISOString();
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? String(v) : new Date(t).toISOString();
};

/** The dossier of a candidate (by candidate_id, else by the account it became). */
export async function dossierOf(db: Db, c: Row<"candidate">): Promise<Row<"dossier"> | null> {
  return (await db.dossier.findOne({ candidate_id: c.id })) ?? (c.converted_account_id ? await db.dossier.findOne({ account_id: c.converted_account_id }) : null);
}

export async function dossierView(db: Db, d: Row<"dossier">): Promise<DossierView> {
  const facts = await db.dossier_fact.all({ dossier_id: d.id }, { orderBy: [{ column: "fact_type", direction: "asc" }] });
  const compIds = [...new Set(facts.map((f) => f.competitor_id).filter((x): x is string => !!x))];
  const comps = compIds.length ? await db.competitor.all({ id: compIds }) : [];
  return {
    summary: d.summary ?? null,
    price_level: (d.price_level ?? null) as DossierView["price_level"],
    facts: facts.map((f) => ({ fact_type: f.fact_type, value: f.value, source_url: f.source_url, retrieved_at: iso(f.retrieved_at) })),
    competitor_brands: [...new Set(comps.map((c) => c.name))].sort(),
  };
}

/** Latest score of a candidate and its reasons in rank order. */
export async function latestScore(db: Db, candidateId: string): Promise<{ score: Row<"candidate_score">; reasons: Row<"candidate_score_reason">[] } | null> {
  const s = (await db.candidate_score.list({ candidate_id: candidateId }, { limit: 1, orderBy: [{ column: "scored_at", direction: "desc" }] })).items[0];
  if (!s) return null;
  const reasons = await db.candidate_score_reason.all({ score_id: s.id }, { orderBy: [{ column: "rank", direction: "asc" }] });
  return { score: s, reasons };
}

export async function candidateCard(db: Db, c: Row<"candidate">): Promise<CandidateCard> {
  const [scored, dossier, dup, rep] = await Promise.all([
    latestScore(db, c.id),
    dossierOf(db, c),
    c.matched_account_id ? db.account.get(c.matched_account_id) : Promise.resolve(null),
    c.assigned_rep_id ? db.app_user.get(c.assigned_rep_id) : Promise.resolve(null),
  ]);
  return {
    candidate_id: c.id,
    business_name: c.business_name,
    status: c.status,
    postal_code: c.postal_code ?? null,
    website: c.website ?? null,
    score: scored ? scored.score.score : null,
    reasons: scored ? scored.reasons.map((r) => r.reason) : [],
    dossier: dossier ? await dossierView(db, dossier) : null,
    duplicate_of: dup ? accountRef(dup) : null,
    assigned_rep: rep ? userRef(rep) : null,
  };
}

// ---- fn:candidate-get
export const impl: Impl<"candidate-get", Principal> = async ({ req, db, me }) => {
  const { candidate } = await requireCandidate(db, me, req.candidate_id);
  return { candidate: await candidateCard(db, candidate), website: candidate.website ?? null, vat_number: candidate.vat_number ?? null };
};

/** Wonderful Function entry (functions/candidate-get/index.ts). Callers: merc-research tool, procedure. */
export const handle = defineSystemFunction("candidate-get", () => impl, (api, req) => orgOfCandidate(api, req.candidate_id));
