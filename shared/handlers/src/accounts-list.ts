// fn:accounts-list (contracts/functions/accounts-list.json, REQ-CORE-009): accounts the caller may see, filtered and paged.
// Scope comes from @merc/core listAccounts (rep: owned + territory, manager: team, admin: all).
// Also exports the AccountRef builder and name normalisation shared with account-resolve.
import { defineFunction, listAccounts, type Db, type Impl, type Principal, type Row, type Where, stripAccents } from "../../core/src/index";

/** No threshold is set in metrics.md for "at risk"; Merc uses risk_score >= 50 (reported as a contract gap). */
export const AT_RISK_MIN_SCORE = 50;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface AccountRef {
  id: string; name: string; account_type: "prospect" | "customer" | "lost";
  postal_code?: string | null; city?: string | null; distance_m?: number | null; reason?: string | null;
}

/** postal_code -> city, from the postal_area lookup. */
export async function cityMap(db: Db, codes: Array<string | null | undefined>): Promise<Map<string, Row<"postal_area">>> {
  const want = [...new Set(codes.filter((c): c is string => !!c))];
  if (!want.length) return new Map();
  return new Map((await db.postal_area.all({ postal_code: want })).map((p) => [p.postal_code, p]));
}

export function accountRef(a: Row<"account">, areas: Map<string, Row<"postal_area">>, extra: { distance_m?: number | null; reason?: string | null } = {}): AccountRef {
  return {
    id: a.id, name: a.name, account_type: a.account_type,
    postal_code: a.postal_code ?? null, city: (a.postal_code && areas.get(a.postal_code)?.city) || null,
    distance_m: extra.distance_m ?? null, reason: extra.reason ?? null,
  };
}

const GREEK: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o",
  π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};
/** Lowercase, strip accents, transliterate Greek, keep letters/digits as space-separated words. */
export function normalizeName(s: string): string {
  const base = stripAccents(s).toLowerCase();
  return [...base.replace(/ου/g, "ou")].map((ch) => GREEK[ch] ?? ch).join("").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Accounts visible to the caller with the contract filters applied (all pages, name order). */
export async function scopedAccounts(db: Db, me: Principal, where: Where<"account"> = {}): Promise<Row<"account">[]> {
  return (await listAccounts(db, me, where, { limit: 5000, offset: 0 })).items;
}

export const impl: Impl<"accounts-list"> = async ({ req, db, me }) => {
  const where: Where<"account"> = {};
  if (req.account_type) where.account_type = req.account_type;
  if (req.territory_id) where.territory_id = req.territory_id;
  if (req.owner_id) where.owner_rep_id = req.owner_id;
  let rows = await scopedAccounts(db, me, where);

  const q = req.q ? normalizeName(req.q) : "";
  if (q) rows = rows.filter((a) => normalizeName(a.name).includes(q) || (a.external_ref ?? "").toLowerCase() === q || (a.vat_number ?? "") === req.q?.trim());

  const risk = new Map<string, Row<"account_metrics">>();
  if (rows.length && req.at_risk !== undefined && req.at_risk !== null) {
    for (const m of await db.account_metrics.all({ account_id: rows.map((a) => a.id) })) risk.set(m.account_id, m);
    const isRisk = (a: Row<"account">) => (risk.get(a.id)?.risk_score ?? 0) >= AT_RISK_MIN_SCORE;
    rows = rows.filter((a) => isRisk(a) === req.at_risk);
  }

  const limit = Math.min(Math.max(req.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = Math.max(req.page ?? 1, 1);
  const slice = rows.slice((page - 1) * limit, page * limit);
  const areas = await cityMap(db, slice.map((a) => a.postal_code));
  const items = slice.map((a) => {
    const m = risk.get(a.id);
    return accountRef(a, areas, { reason: req.at_risk && m ? `risk ${m.risk_score}${m.risk_reasons ? `: ${m.risk_reasons}` : ""}` : null });
  });
  return { items, page: { page, limit, total: rows.length } };
};

/** Wonderful Function entry (functions/accounts-list/index.ts calls this). */
export const handle = defineFunction("accounts-list", impl);
