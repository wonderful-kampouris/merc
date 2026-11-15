// fn:dossier-save (contracts/functions/dossier-save.json, REQ-PRS-003, REQ-PRS-005). merc-research tool.
// Saves (or replaces) the dossier of a candidate or account. Every fact needs a source_url; facts whose source is
// a maps or review platform are rejected and counted, never stored. retrieved_at is the save time.
import { invalid, type Db, type Impl, type Principal, type Row } from "../../core/src/index";
import { defineSystemFunction, orgOfAccount, orgOfCandidate, requireCandidate } from "./candidate-get";
import { normName } from "./candidate-dedupe";

/** Maps and review platforms (REQ-PRS-005; list from spike S5, prospect_proof.py, plus generic map hosts/paths). */
export const BLOCKED_SOURCES = [
  "google.", "goo.gl", "maps.app.goo.gl", "maps.apple.", "bing.com/maps", "waze.com", "here.com",
  "tripadvisor.", "yelp.", "foursquare.", "facebook.com/pages/reviews", "trustpilot.",
  "efood.gr", "wolt.com", "box.gr", "restaurantguru.", "citymaps.gr", "wanderlog.",
] as const;
export const FACT_TYPES = ["product", "brand", "price", "review_theme", "catalog_item", "opening_hours", "size_signal"] as const;

/** Why a source is not allowed, or null when it is. */
export function sourceProblem(url: string | null | undefined): string | null {
  const s = String(url ?? "").trim();
  if (!s) return "missing source_url";
  const m = /^https?:\/\/([^/?#\s]+)([^?#\s]*)/i.exec(s);
  if (!m) return "source_url must be an http(s) URL";
  const host = m[1]!.toLowerCase().replace(/^[^@]*@/, "").replace(/:\d+$/, "");
  const full = host + m[2]!.toLowerCase();
  if (host.startsWith("maps.") || /\/maps(\/|$)/.test(m[2]!.toLowerCase())) return "maps service";
  const hit = BLOCKED_SOURCES.find((b) => full.includes(b));
  return hit ? `blocked source ${hit.replace(/\.$/, "")}` : null;
}

type FactIn = { fact_type: string; value: string; source_url: string; competitor_name?: string | null };

async function competitorIndex(db: Db): Promise<Array<{ id: string; key: string }>> {
  return (await db.competitor.all()).map((c) => ({ id: c.id, key: normName(c.name) })).filter((c) => c.key.length >= 3);
}
function competitorFor(index: Array<{ id: string; key: string }>, f: FactIn): string | null {
  const named = f.competitor_name ? normName(f.competitor_name) : "";
  if (named) return index.find((c) => c.key === named || named.includes(c.key) || c.key.includes(named))?.id ?? null;
  if (f.fact_type !== "brand") return null;
  const v = ` ${normName(f.value)} `;
  return index.find((c) => v.includes(` ${c.key} `))?.id ?? null;
}

export function makeImpl(deps: { now?: () => number } = {}): Impl<"dossier-save", Principal> {
  return async ({ req, db, me }) => {
    const now = new Date(deps.now?.() ?? Date.now()).toISOString();
    let candidate: Row<"candidate"> | null = null;
    let accountId: string | null = null;
    if (req.candidate_id) {
      candidate = (await requireCandidate(db, me, req.candidate_id)).candidate;
      accountId = candidate.converted_account_id ?? null;
    }
    if (req.account_id) {
      const a = await db.account.require(req.account_id);
      if (accountId && accountId !== a.id) throw invalid("account_id does not match the candidate's account", { account_id: a.id });
      accountId = a.id;
    }
    if (!candidate && !accountId) throw invalid("candidate_id or account_id is required");

    const accepted: Array<FactIn & { competitor_id: string | null }> = [];
    const rejected: Array<{ index: number; reason: string }> = [];
    const comps = await competitorIndex(db);
    (req.facts as FactIn[]).forEach((f, index) => {
      const value = String(f.value ?? "").trim();
      const problem = !(FACT_TYPES as readonly string[]).includes(f.fact_type) ? `unknown fact_type ${f.fact_type}` : !value ? "empty value" : sourceProblem(f.source_url);
      if (problem) rejected.push({ index, reason: problem });
      else accepted.push({ ...f, value, source_url: f.source_url.trim(), competitor_id: competitorFor(comps, f) });
    });
    if (rejected.length) console.log(`[dossier-save] rejected ${rejected.length} fact(s): ${JSON.stringify(rejected).slice(0, 500)}`);

    const patch = { summary: req.summary, price_level: req.price_level ?? null, researched_at: now, research_task_id: req.research_task_id ?? null };
    let dossier = (candidate ? await db.dossier.findOne({ candidate_id: candidate.id }) : null) ?? (accountId ? await db.dossier.findOne({ account_id: accountId }) : null);
    if (dossier) {
      dossier = await db.dossier.update(dossier.id, { ...patch, ...(accountId && !dossier.account_id ? { account_id: accountId } : {}) });
      for (const f of await db.dossier_fact.all({ dossier_id: dossier.id })) await db.dossier_fact.delete(f.id);   // a new research replaces the old facts
    } else {
      dossier = await db.dossier.insert({ candidate_id: candidate?.id ?? null, account_id: accountId, ...patch } as any);
    }
    for (const f of accepted) {
      await db.dossier_fact.insert({ dossier_id: dossier.id, fact_type: f.fact_type, value: f.value, competitor_id: f.competitor_id, source_url: f.source_url, retrieved_at: now } as any);
    }
    if (candidate && candidate.status === "new") await db.candidate.update(candidate.id, { status: "researched" });
    return { dossier_id: dossier.id, facts_saved: accepted.length, facts_rejected: rejected.length };
  };
}
export const impl = makeImpl();

/** Wonderful Function entry (functions/dossier-save/index.ts). Caller: merc-research save_dossier tool. */
export const handle = defineSystemFunction("dossier-save", () => impl, (api, req) =>
  req.candidate_id ? orgOfCandidate(api, req.candidate_id) : req.account_id ? orgOfAccount(api, req.account_id) : Promise.reject(invalid("candidate_id or account_id is required")));
