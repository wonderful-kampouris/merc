// fn:account-resolve (contracts/functions/account-resolve.json, REQ-CRD-003): which account does the rep mean?
// Evidence order: exact/fuzzy name in the caller's scope -> today's visits -> nearest (lat/lng, never stored).
// More than one remaining candidate gives "ambiguous" and the buddy asks.
import { defineFunction, today, type Db, type Impl, type Principal, type Row } from "../../core/src/index";
import { accountRef, cityMap, normalizeName, scopedAccounts, type AccountRef } from "./accounts-list";

export const MAX_CANDIDATES = 5;
/** Nearest wins only within this radius and when clearly closer than the runner-up. */
export const NEAR_M = 150;
export const SUGGEST_M = 1000;

const STOP = new Set(["the", "a", "an", "at", "in", "to", "i", "im", "m", "me", "my", "is", "am", "of", "with", "eimai", "sto", "sti", "stin", "ston", "sta", "stous", "to", "o", "oi", "ta", "tou", "tis", "ton", "tin", "ena", "enan", "mia", "apo", "edo", "ekei"]);
const SYN: Record<string, string> = { kafe: "cafe", kafes: "cafe", kafeteria: "cafe", cafeteria: "cafe", kafeneio: "cafe", fourno: "fournos", fournou: "fournos" };
const tokens = (s: string) => normalizeName(s).split(" ").filter(Boolean).map((t) => SYN[t] ?? t);

/** Optimal string alignment distance: insert, delete, substitute, or swap two adjacent letters each cost 1. */
export function lev(a: string, b: string): number {
  if (a === b) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
    d[i]![j] = v;
  }
  return d[a.length]![b.length]!;
}
/** 3 equal, 2 prefix, 1 typo, 0 no match. */
function tokenScore(h: string, n: string): number {
  if (h === n) return 3;
  if (h.length >= 3 && n.startsWith(h)) return 2;
  if (h.length >= 4 && lev(h, n) <= (h.length >= 7 ? 2 : 1)) return 1;
  return 0;
}
/** Name match quality: 4 exact full name, else the weakest hint token's best score (0 = no match). */
export function nameScore(hint: string, name: string): number {
  const all = tokens(hint), nt = tokens(name);
  const ht = all.filter((t) => !STOP.has(t));
  if (!ht.length || !nt.length) return 0;
  if (all.join(" ") === nt.join(" ") || ht.join(" ") === nt.join(" ")) return 4;
  return Math.min(...ht.map((h) => Math.max(...nt.map((n) => tokenScore(h, n)))));
}

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (d: number) => (d * Math.PI) / 180, R = 6_371_000;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

type Cand = { a: Row<"account">; d: number | null; why: string };

async function todaysAccountIds(db: Db, me: Principal): Promise<string[]> {
  if (me.kind !== "user") return [];
  const visits = await db.visit.all({ rep_id: me.id, planned_date: today(me.org) }, { orderBy: [{ column: "route_position", direction: "asc" }] });
  return [...new Set(visits.filter((v) => v.status !== "skipped").map((v) => v.account_id))];
}

/** The nearest candidate if it is within NEAR_M and clearly closer than the next one. */
function clearNearest(cands: Cand[]): Cand | null {
  const s = cands.filter((c) => c.d !== null).sort((x, y) => x.d! - y.d!);
  const [first, second] = s;
  if (!first || first.d! > NEAR_M) return null;
  return !second || second.d! >= 2 * first.d! || second.d! - first.d! >= 100 ? first : null;
}

export const impl: Impl<"account-resolve"> = async ({ req, db, me }) => {
  const scope = await scopedAccounts(db, me);
  const areas = await cityMap(db, scope.map((a) => a.postal_code));
  const here = typeof req.lat === "number" && typeof req.lng === "number" ? { lat: req.lat, lng: req.lng } : null;
  const dist = (a: Row<"account">): number | null => {
    if (!here) return null;
    const p = typeof a.lat === "number" && typeof a.lng === "number" ? a : a.postal_code ? areas.get(a.postal_code) : undefined;
    return p && typeof p.lat === "number" && typeof p.lng === "number" ? Math.round(haversineM(here.lat, here.lng, p.lat, p.lng)) : null;
  };
  const ref = (c: Cand) => accountRef(c.a, areas, { distance_m: c.d, reason: c.why });
  const byDist = (cs: Cand[]) => (here ? [...cs].sort((x, y) => (x.d ?? Infinity) - (y.d ?? Infinity)) : cs);
  const resolved = (c: Cand) => ({ status: "resolved" as const, account: ref(c), candidates: [ref(c)] });
  const ambiguous = (cs: Cand[]) => ({ status: "ambiguous" as const, account: null, candidates: byDist(cs).slice(0, MAX_CANDIDATES).map(ref) });
  const notFound = (cs: Cand[] = []) => ({ status: "not_found" as const, account: null, candidates: byDist(cs).slice(0, MAX_CANDIDATES).map(ref) });

  const todayIds = await todaysAccountIds(db, me);
  const hint = (req.hint ?? "").trim();

  // 1. name in scope
  if (hint) {
    const scored = scope.map((a) => ({ a, s: nameScore(hint, a.name) })).filter((x) => x.s > 0);
    if (!scored.length) return notFound();
    const best = Math.max(...scored.map((x) => x.s));
    const matches: Cand[] = scored.filter((x) => x.s === best).map((x) => ({ a: x.a, d: dist(x.a), why: best === 4 ? "exact name" : "name match" }));
    if (matches.length === 1) return resolved(matches[0]!);
    // 2. today's visits narrow the name matches
    const visited = matches.filter((c) => todayIds.includes(c.a.id)).map((c) => ({ ...c, why: "name match, visit today" }));
    if (visited.length === 1) return resolved(visited[0]!);
    // 3. nearest among what is left
    const pool = visited.length ? visited : matches;
    const near = clearNearest(pool);
    if (near) return resolved({ ...near, why: `${near.why}, nearest (${near.d} m)` });
    return ambiguous(pool);
  }

  // No hint: today's visits, then nearest.
  const visits: Cand[] = todayIds.map((id) => scope.find((a) => a.id === id)).filter((a): a is Row<"account"> => !!a).map((a) => ({ a, d: dist(a), why: "visit today" }));
  if (visits.length === 1 && !here) return resolved(visits[0]!);
  if (visits.length) {
    const near = clearNearest(visits);
    if (near) return resolved({ ...near, why: `visit today, nearest (${near.d} m)` });
    if (visits.length === 1 && visits[0]!.d === null) return resolved(visits[0]!);
  }
  if (here) {
    const all: Cand[] = scope.map((a) => ({ a, d: dist(a), why: "nearby" }));
    const near = clearNearest(all);
    if (near) return resolved({ ...near, why: `nearest (${near.d} m)` });
    const close = all.filter((c) => c.d !== null && c.d <= SUGGEST_M);
    if (visits.length) return ambiguous(visits);
    return close.length ? ambiguous(close) : notFound();
  }
  return visits.length ? ambiguous(visits) : notFound();
};

/** Wonderful Function entry (functions/account-resolve/index.ts calls this). */
export const handle = defineFunction("account-resolve", impl);
export type { AccountRef };
