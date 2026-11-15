// fn:candidate-score (contracts/functions/candidate-score.json, REQ-PRS-004). Procedure step after research.
// The LLM (contracts/llm/candidate_score.json, profile merc-decide) rates each ICP criterion 0-1 with a reason.
// Code owns the rest: near_route comes from the distance to the rep's route this week, the score is
// 100 x sum(weight x rating) / sum(weight) rounded to an integer, and the top 3 reasons by weight x rating are stored.
import { MercError, today, weekRange, type Db, type Impl, type Principal, type Row } from "../../core/src/index";
import { callStructured, type ModelFactory } from "../../llm/src/index";
import { defineSystemFunction, dossierOf, dossierView, orgOfCandidate, requireCandidate } from "./candidate-get";

export const NEAR_ROUTE = "near_route";
/** Full near_route rating within this distance, zero beyond NEAR_ZERO_M, linear in between. */
export const NEAR_FULL_M = 500;
export const NEAR_ZERO_M = 5000;
/** Rating used when the shop or the route has no coordinates. */
export const NEAR_UNKNOWN = 0.5;

export interface ScoreDeps { model?: ModelFactory; now?: () => number }
export interface Point { lat: number; lng: number }

export function haversineM(a: Point, b: Point): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function nearRouteRating(distanceM: number | null): number {
  if (distanceM === null || !Number.isFinite(distanceM)) return NEAR_UNKNOWN;
  if (distanceM <= NEAR_FULL_M) return 1;
  if (distanceM >= NEAR_ZERO_M) return 0;
  return Math.round((1 - (distanceM - NEAR_FULL_M) / (NEAR_ZERO_M - NEAR_FULL_M)) * 100) / 100;
}
export function nearRouteReason(distanceM: number | null): string {
  if (distanceM === null) return "Distance to the route is unknown";
  return distanceM < 1000 ? `About ${Math.round(distanceM / 10) * 10} m from this week's route` : `About ${(distanceM / 1000).toFixed(1)} km from this week's route`;
}
const clamp01 = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export interface Rated { criterion: string; weight: number; rating: number; reason: string }
/** score = 100 x sum(weight x rating) / sum(weight), integer (metrics: contracts/llm/candidate_score.json). */
export function weightedScore(rated: Rated[]): number {
  const w = rated.reduce((s, r) => s + Math.max(0, r.weight), 0);
  if (w <= 0) return 0;
  return Math.round((100 * rated.reduce((s, r) => s + Math.max(0, r.weight) * r.rating, 0)) / w);
}
/** Top 3 reasons by weight x rating (ties: higher weight, then criterion name). */
export function topReasons(rated: Rated[], n = 3): Array<{ criterion: string; reason: string }> {
  return [...rated]
    .sort((a, b) => b.weight * b.rating - a.weight * a.rating || b.weight - a.weight || a.criterion.localeCompare(b.criterion))
    .slice(0, n)
    .map((r) => ({ criterion: r.criterion, reason: r.reason }));
}

export async function candidatePoint(db: Db, c: Row<"candidate">): Promise<Point | null> {
  if (typeof c.lat === "number" && typeof c.lng === "number") return { lat: c.lat, lng: c.lng };
  if (!c.postal_code) return null;
  const pa = await db.postal_area.get(c.postal_code);
  return pa && typeof pa.lat === "number" && typeof pa.lng === "number" ? { lat: pa.lat, lng: pa.lng } : null;
}
/** Distance (m) from the point to the nearest account on the rep's planned visits this week; else to their owned accounts. */
export async function routeDistanceM(db: Db, org: Row<"organization">, repId: string, p: Point | null, now: number): Promise<number | null> {
  if (!p) return null;
  const wk = weekRange(org, today(org, now));
  const visits = await db.visit.all({ rep_id: repId, status: "planned", planned_date: { op: "gte", value: wk.fromDate } });
  const ids = [...new Set(visits.filter((v) => v.planned_date <= wk.toDate).map((v) => v.account_id))];
  const accounts = ids.length ? await db.account.all({ id: ids }) : await db.account.all({ owner_rep_id: repId }, { cap: 500 });
  const ds = accounts.filter((a) => typeof a.lat === "number" && typeof a.lng === "number").map((a) => haversineM(p, { lat: a.lat as number, lng: a.lng as number }));
  return ds.length ? Math.round(Math.min(...ds)) : null;
}

export async function scoreCandidate(db: Db, me: Principal, c: Row<"candidate">, deps: ScoreDeps = {}): Promise<{ score: number; reasons: Array<{ criterion: string; reason: string }> }> {
  const now = deps.now?.() ?? Date.now();
  const search = await db.prospect_search.require(c.search_id);
  const criteria = await db.icp_criterion.all();
  if (!criteria.length) throw new MercError("validation_failed", "the organization has no ICP criteria to score against");
  const icpCats = await db.icp_category.all();
  const catRows = icpCats.length ? await db.account_category.all({ id: icpCats.map((x) => x.category_id) }) : [];
  const category = search.category_id ? (await db.account_category.get(search.category_id))?.name ?? null : null;
  const dossier = await dossierOf(db, c);
  const listing = `Listing: ${c.business_name}${c.postal_code ? `, postal code ${c.postal_code}` : ""}${c.website ? `, website ${c.website}` : ", no website"}.`;
  const view = dossier ? await dossierView(db, dossier) : { summary: null, price_level: null, facts: [], competitor_brands: [] };
  view.summary = [view.summary ?? "No research dossier yet.", listing].join(" ");
  const distance = await routeDistanceM(db, me.org, c.assigned_rep_id ?? search.requested_by, await candidatePoint(db, c), now);

  const modelCriteria = criteria.filter((k) => k.criterion !== NEAR_ROUTE).map((k) => ({ criterion: k.criterion, weight: k.weight }));
  const r = await callStructured("candidate_score", {
    dossier: view, category, distance_to_route_m: distance,
    icp: { target_categories: catRows.map((x) => x.name).sort(), criteria: modelCriteria },
  }, { model: deps.model, temperature: 0, instructions: "Rate only the listed criteria. Do not rate near_route. Each reason is one short sentence citing the dossier." });
  if (!r.ok) throw new MercError(r.error.code, r.error.message, (r.error.details ?? null) as Record<string, unknown> | null);
  r.logs.forEach((l) => console.log(`[candidate-score] ${l}`));

  const byName = new Map(r.value.ratings.map((x) => [x.criterion, x]));
  const rated: Rated[] = criteria.map((k) => k.criterion === NEAR_ROUTE
    ? { criterion: k.criterion, weight: k.weight, rating: nearRouteRating(distance), reason: nearRouteReason(distance) }
    : { criterion: k.criterion, weight: k.weight, rating: clamp01(byName.get(k.criterion)?.rating), reason: byName.get(k.criterion)?.reason?.trim() || `${k.criterion} not rated` });
  const score = weightedScore(rated);
  const reasons = topReasons(rated);

  const row = await db.candidate_score.insert({ candidate_id: c.id, score, model_profile: r.profile, scored_at: new Date(now).toISOString() } as any);
  for (const [i, x] of reasons.entries()) await db.candidate_score_reason.insert({ score_id: row.id, rank: i + 1, criterion: x.criterion, reason: x.reason } as any);
  if (c.status === "new" || c.status === "researched") await db.candidate.update(c.id, { status: "scored" });
  return { score, reasons };
}

export function makeImpl(deps: ScoreDeps = {}): Impl<"candidate-score", Principal> {
  return async ({ req, db, me }) => {
    const { candidate } = await requireCandidate(db, me, req.candidate_id);
    return scoreCandidate(db, me, candidate, deps);
  };
}
export const impl = makeImpl();

/** Wonderful Function entry (functions/candidate-score/index.ts). Caller: procedure prospecting-pipeline. */
export const handle = defineSystemFunction("candidate-score", () => impl, (api, req) => orgOfCandidate(api, req.candidate_id));
