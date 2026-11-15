// fn:campaign-draft-from-text (contracts/functions/campaign-draft-from-text.json, REQ-CMP-001): turn a manager's free
// text ("Push Espresso Nuovo to cafés in North and Center this week") into a campaign form. The LLM (contract
// campaign_from_text, profile merc-extract) picks names only from the input lists; this code resolves every name to an
// id (accent/case/plural tolerant, unique prefix match) and lists the names it could not resolve in `unresolved`.
// The draft has the fn:campaign-upsert request shape (status "draft") plus the resolved *_names for display.
// Writes nothing. If the model is unavailable or fails, a deterministic name scan of the text fills the form instead.
import { addDays, defineFunction, isAdmin, isDate, MercError, today, visibleTerritoryIds, visibleUserIds, type Impl, type Principal } from "../../core/src/index";
import { callStructured, type ModelFactory } from "../../llm/src/index";

export interface DraftDeps { model?: ModelFactory; now?: () => number; log?: (m: string) => void }
interface Cand { id: string; name: string }

/** Lowercase, no accents, alphanumerics only, light English plural stemming. */
export function tokens(s: string): string[] {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9\u0370-\u03ff]+/).filter(Boolean)
    .map((t) => (t.length > 4 && t.endsWith("ies") ? `${t.slice(0, -3)}y` : t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}
const key = (s: string) => tokens(s).join(" ");

/** Resolve a name: exact (normalized) match, else the unique candidate whose tokens start with every query token. */
export function resolveName(name: string, cands: Cand[]): Cand | null {
  const q = tokens(name);
  if (!q.length) return null;
  const exact = cands.filter((c) => key(c.name) === q.join(" "));
  if (exact.length === 1) return exact[0]!;
  const hits = cands.filter((c) => { const ct = tokens(c.name); return q.every((t) => ct.some((x) => x.startsWith(t))); });
  return hits.length === 1 ? hits[0]! : null;
}

/** Deterministic fallback: a candidate is named in the text when its leading `words` words (letters only) appear in order. */
export function scanText(text: string, cands: Cand[], words = 2): string[] {
  const hay = ` ${tokens(text).join(" ")} `;
  return cands.filter((c) => {
    const lead = tokens(c.name).filter((t) => /^[a-z\u0370-\u03ff]+$/.test(t)).slice(0, words);
    return lead.length > 0 && hay.includes(` ${lead.join(" ")} `);
  }).map((c) => c.name);
}

export function makeImpl(deps: DraftDeps = {}): Impl<"campaign-draft-from-text", Principal> {
  return async ({ req, db, me }) => {
    const text = req.text.trim();
    if (!text) throw new MercError("validation_failed", "text is required", { field: "text" });
    const now = deps.now ?? Date.now, log = deps.log ?? (() => undefined);
    const day = today(me.org, now());

    // Candidate lists: active products, all account categories, territories and active reps in the caller's scope.
    const terrScope = isAdmin(me) ? null : visibleTerritoryIds(me);
    const userScope = isAdmin(me) ? null : visibleUserIds(me);
    const [productRows, territoryRows, categoryRows, userRows] = await Promise.all([
      db.product.all(), db.territory.all(), db.account_category.all(), db.app_user.all({ role_code: "rep", status: "active" } as never),
    ]);
    const products: Cand[] = productRows.filter((p) => p.active !== false).map((p) => ({ id: p.id, name: p.name }));
    const territories: Cand[] = territoryRows.filter((t) => !terrScope || terrScope.includes(t.id)).map((t) => ({ id: t.id, name: t.name }));
    const categories: Cand[] = categoryRows.map((c) => ({ id: c.id, name: c.name }));
    const reps: Cand[] = userRows.filter((u) => !userScope || userScope.includes(u.id)).map((u) => ({ id: u.id, name: u.full_name }));

    let out: { title: string; message: string; starts_on?: string | null; ends_on?: string | null; product_names: string[]; territory_names: string[]; category_names: string[]; rep_names: string[] };
    const r = await callStructured("campaign_from_text", {
      text, today: day, products: products.map((c) => c.name), territories: territories.map((c) => c.name),
      categories: categories.map((c) => c.name), reps: reps.map((c) => c.name),
    }, {
      model: deps.model,
      instructions: "starts_on/ends_on: ISO dates computed from `today` ('this week' = today until Sunday of this week, or the next 7 days when today is Sunday); null when the text gives no time. title: short (max 60 chars). message: one or two sentences the reps will read.",
    }).catch((e: unknown) => ({ ok: false as const, error: { code: "upstream_failed", message: String((e as Error)?.message ?? e) } }));
    if (r.ok) out = r.value as typeof out;
    else {
      log(`campaign-draft-from-text: LLM unavailable (${r.error.code}: ${r.error.message}); using the deterministic name scan`);
      out = {
        title: text.length > 60 ? `${text.slice(0, 57)}...` : text, message: text, starts_on: null, ends_on: null,
        product_names: scanText(text, products), territory_names: scanText(text, territories), category_names: scanText(text, categories), rep_names: scanText(text, reps, 1),
      };
    }

    const unresolved: string[] = [];
    const resolve = (names: string[], cands: Cand[]) => {
      const hits: Cand[] = [];
      for (const n of names ?? []) {
        const c = resolveName(n, cands);
        if (c) { if (!hits.some((h) => h.id === c.id)) hits.push(c); } else if (n.trim() && !unresolved.includes(n.trim())) unresolved.push(n.trim());
      }
      return hits;
    };
    const p = resolve(out.product_names, products), t = resolve(out.territory_names, territories);
    const c = resolve(out.category_names, categories), u = resolve(out.rep_names, reps);

    let starts = isDate(out.starts_on) ? out.starts_on! : day;
    let ends = isDate(out.ends_on) ? out.ends_on! : addDays(starts, 6);
    if (starts < day) starts = day;
    if (ends < starts) ends = addDays(starts, 6);

    return {
      draft: {
        campaign_id: null,
        title: (out.title || text).trim().slice(0, 120), message: (out.message || text).trim(),
        starts_on: starts, ends_on: ends, status: "draft",
        product_ids: p.map((x) => x.id), territory_ids: t.map((x) => x.id), category_ids: c.map((x) => x.id), rep_ids: u.map((x) => x.id),
        product_names: p.map((x) => x.name), territory_names: t.map((x) => x.name), category_names: c.map((x) => x.name), rep_names: u.map((x) => x.name),
        source: r.ok ? "llm" : "fallback",
      },
      unresolved,
    };
  };
}
export const impl = makeImpl();
export const handle = defineFunction("campaign-draft-from-text", impl);
