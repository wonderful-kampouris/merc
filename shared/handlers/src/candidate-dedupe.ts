// fn:candidate-dedupe (contracts/functions/candidate-dedupe.json, REQ-PRS-002). Procedure step.
// Rules, in order: VAT exact; website domain; phone E.164; normalized name + same postal code (trigram >= 0.85).
// Each rule is checked against the org's accounts first, then against other live candidates of the org.
import type { Db, Impl, Principal, Row } from "../../core/src/index";
import { defineSystemFunction, orgOfCandidate, requireCandidate } from "./candidate-get";

export type DedupeRule = "vat" | "website" | "phone" | "name";
export const RULES: readonly DedupeRule[] = ["vat", "website", "phone", "name"];
export const NAME_THRESHOLD = 0.85;

// ---- normalizers (exported: candidate-add, directory-search and tests use them)
const GREEK: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o",
  π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};
/** Lowercase, no accents, Greek transliterated to Latin, punctuation to spaces. "Φούρνος Σταύρου" -> "fournos stayroy". */
export function normName(s: string | null | undefined): string {
  const base = String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ");
  let out = "";
  for (const ch of base) out += GREEK[ch] ?? ch;
  // Greek "ου" transliterates to "oy" above; fold to "ou" so "Σταύρου" and "Stavrou"-style spellings meet.
  return out.replace(/oy/g, "ou").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
/** pg_trgm-style trigram set: each word padded with two leading spaces and one trailing space. */
export function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.split(" ").filter(Boolean)) {
    const p = `  ${w} `;
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}
/** Trigram similarity |A ∩ B| / |A ∪ B| of two normalized names (0..1). */
export function similarity(a: string, b: string): number {
  const A = trigrams(normName(a)), B = trigrams(normName(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
/** Greek VAT (AFM): 9 digits, optional EL/GR prefix. Null when not a valid shape. */
export function normVat(v: string | null | undefined): string | null {
  const d = String(v ?? "").trim().replace(/^(EL|GR)/i, "").replace(/\D/g, "");
  return d.length === 9 ? d : null;
}
/** Website host without scheme, port, path or leading www. Null when empty. */
export function normDomain(url: string | null | undefined): string | null {
  const s = String(url ?? "").trim().toLowerCase();
  if (!s) return null;
  const host = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0]!.replace(/^[^@]*@/, "").replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}
/** Phone in E.164. Greek national numbers (10 digits, 2x landline / 69x mobile) get +30. Null when unsure. */
export function normPhone(p: string | null | undefined): string | null {
  const raw = String(p ?? "").trim();
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (d.startsWith("+")) { const n = d.slice(1).replace(/\D/g, ""); return n.length >= 8 && n.length <= 15 ? `+${n}` : null; }
  d = d.replace(/\D/g, "");
  if (d.length === 10 && /^(2|69)/.test(d)) return `+30${d}`;
  if (d.length === 12 && d.startsWith("30")) return `+${d}`;
  return null;
}

// ---- matching
export interface DedupeMatch { rule: DedupeRule; account: Row<"account"> | null; candidate: Row<"candidate"> | null }
const DEAD = new Set(["duplicate", "dismissed", "failed"]);

/** Other live candidates of the org matching `where` (excluding `self`). */
async function orgCandidates(db: Db, self: Row<"candidate">, where: Parameters<Db["candidate"]["all"]>[0]): Promise<Row<"candidate">[]> {
  const searches = (await db.prospect_search.all()).map((s) => s.id);
  if (!searches.length) return [];
  return (await db.candidate.all({ ...where, search_id: searches })).filter((c) => c.id !== self.id && !DEAD.has(c.status));
}

/** First matching record by the REQ-PRS-002 rule order, accounts before candidates. Null = not a duplicate. */
export async function findDuplicate(db: Db, c: Row<"candidate">): Promise<DedupeMatch | null> {
  const vat = normVat(c.vat_number);
  if (vat) {
    const keys = [vat, `EL${vat}`, `GR${vat}`];
    const a = (await db.account.all({ vat_number: keys }))[0];
    if (a) return { rule: "vat", account: a, candidate: null };
    const o = (await orgCandidates(db, c, { vat_number: keys }))[0];
    if (o) return { rule: "vat", account: null, candidate: o };
  }
  const dom = normDomain(c.website);
  if (dom) {
    const like = { op: "contains" as const, value: dom };
    const a = (await db.account.all({ website: like })).find((x) => normDomain(x.website) === dom);
    if (a) return { rule: "website", account: a, candidate: null };
    const o = (await orgCandidates(db, c, { website: like })).find((x) => normDomain(x.website) === dom);
    if (o) return { rule: "website", account: null, candidate: o };
  }
  const ph = normPhone(c.phone);
  if (ph) {
    const keys = ph.startsWith("+30") ? [ph, ph.slice(3)] : [ph];
    const a = (await db.account.all({ phone: keys }))[0];
    if (a) return { rule: "phone", account: a, candidate: null };
    const o = (await orgCandidates(db, c, { phone: keys }))[0];
    if (o) return { rule: "phone", account: null, candidate: o };
  }
  if (c.postal_code) {
    const best = <T extends { name?: string; business_name?: string }>(rows: T[], name: (r: T) => string) =>
      rows.map((r) => ({ r, s: similarity(c.business_name, name(r)) })).filter((x) => x.s >= NAME_THRESHOLD).sort((x, y) => y.s - x.s)[0]?.r;
    const a = best(await db.account.all({ postal_code: c.postal_code }), (r) => r.name);
    if (a) return { rule: "name", account: a, candidate: null };
    const o = best(await orgCandidates(db, c, { postal_code: c.postal_code }), (r) => r.business_name);
    if (o) return { rule: "name", account: null, candidate: o };
  }
  return null;
}

export interface DedupeResult { duplicate: boolean; matched_account_id: string | null; matched_candidate_id: string | null; rule: DedupeRule | null }

/** Run the rules and, for a candidate still `new`, mark it `duplicate` with the matched account. */
export async function dedupeCandidate(db: Db, c: Row<"candidate">): Promise<DedupeResult> {
  const m = await findDuplicate(db, c);
  if (!m) return { duplicate: false, matched_account_id: null, matched_candidate_id: null, rule: null };
  const accountId = m.account?.id ?? m.candidate?.converted_account_id ?? m.candidate?.matched_account_id ?? null;
  if (c.status === "new" || c.status === "duplicate") await db.candidate.update(c.id, { status: "duplicate", matched_account_id: accountId });
  return { duplicate: true, matched_account_id: accountId, matched_candidate_id: m.candidate?.id ?? null, rule: m.rule };
}

export const impl: Impl<"candidate-dedupe", Principal> = async ({ req, db, me }) => {
  const { candidate } = await requireCandidate(db, me, req.candidate_id);
  return dedupeCandidate(db, candidate);
};

/** Wonderful Function entry (functions/candidate-dedupe/index.ts). Caller: procedure prospecting-pipeline. */
export const handle = defineSystemFunction("candidate-dedupe", () => impl, (api, req) => orgOfCandidate(api, req.candidate_id));
