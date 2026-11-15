// fn:visit-brief-get (contracts/functions/visit-brief-get.json, REQ-MTG-002 / REQ-MTG-003 / REQ-MTG-008).
// The pre-meeting brief: at most 6 bullets (why, open problem or promise, orders vs usual, push, avoid, how to talk)
// and a spoken script of at most 45 s.
// - Facts come from the visit card handler (visit-card-get makeImpl), not re-implemented here.
// - Push / avoid are chosen in code, exactly as contracts/metrics.md#visit-brief-hints (chooseHints below).
// - The LLM (visit_brief_bullets on merc-write) only words them, framed by the Context Hub KB merc-company.
//   Output naming a product other than push/avoid (or one already in the facts) is rejected; a bullet with a number
//   that is not in a fact is dropped. Anything rejected falls back to deterministic, code-built wording.
import {
  addDays, defineFunction, invalid, validateResponse, localParts, notFound, requireAccount, today,
  type Db, type FunctionContext, type Impl, type PlatformLike, type Principal, type Row, type UserPrincipal,
} from "../../core/src/index";
import type { FunctionResponseMap } from "../../core/src/generated/contracts/types";
import { callStructured, normalizeText, unknownNumbers, type CallResult, type LlmInputMap, type LlmOutputMap } from "../../llm/src/index";
import { fitSpoken, kbFromApi, makeImpl as makeCardImpl, usualItems, type KbApi, type VisitCard } from "./visit-card-get";

export type VisitBrief = FunctionResponseMap["visit-brief-get"];
export type BulletsInput = LlmInputMap["visit_brief_bullets"];
export type BulletsOutput = LlmOutputMap["visit_brief_bullets"];
export type Bullet = VisitBrief["bullets"][number];

export interface BriefDeps {
  /** One structured visit_brief_bullets call (default: shared/llm callStructured on merc-write). */
  bullets(input: BulletsInput): Promise<CallResult<BulletsOutput>>;
  /** Passages from the Context Hub KB merc-company; [] when unavailable. Must not throw. */
  kb(question: string): Promise<string[]>;
  now?: () => number;
  log?: (msg: string) => void;
}

export const MAX_BULLETS = 6;
export const MAX_SECONDS = 45;
export const MAX_BULLET_WORDS = 15;
/** Contract rule: script <= 2.3 words/s x max_seconds. */
export const MAX_SCRIPT_WORDS = Math.floor(2.3 * MAX_SECONDS);
export const FEEDBACK_DAYS = 30;
export const RECENT_ORDER_DAYS = 30;
export const CAMPAIGN_BOOST = 50;
export const PROBLEM_BOOST = 25;
export const BRIEF_INSTRUCTIONS = [
  "Write the bullets in the input language (el = Greek, en = English). Keep product names exactly as given.",
  "fact_labels: the labels of the facts each bullet uses ([] for none).",
  "The push bullet names push.name with its reason; the avoid bullet names avoid.name with its reason.",
  "Do not mention any other product except the ones that already appear in a fact value.",
  "Never write a number that is not in a fact value: no counts, prices, dates or percents of your own.",
].join("\n");

// ---------------------------------------------------------------------------------------------- product names
const words = (s: string) => s.split(/\s+/).filter(Boolean);
/** "Espresso Nuovo Blend 1kg" -> "Espresso Nuovo Blend" (drop size tokens), for display. */
export const shortName = (name: string) => words(name).filter((w) => !/\d/.test(w)).join(" ") || name;
/** Normalized key a mention is matched on: the first two non-size words ("espresso nuovo", "frappe instant"). */
export const productKey = (name: string) => normalizeText(words(shortName(name)).slice(0, 2).join(" "));
/** Product ids whose key appears (whole words) in the text. */
export function productsMentioned(text: string, products: Array<{ id: string; name: string }>): Set<string> {
  const t = ` ${normalizeText(text)} `;
  return new Set(products.filter((p) => { const k = productKey(p.name); return !!k && t.includes(` ${k} `); }).map((p) => p.id));
}

// ---------------------------------------------------------------------------------------------- metrics.md#visit-brief-hints
export interface Hint { product_id: string; name: string; reason: string; guidance_id: string; score: number }
export interface HintInput {
  today: string;
  category_id: string | null;
  guidance: Array<Pick<Row<"product_guidance">, "id" | "product_id" | "category_id" | "stance" | "reason" | "priority" | "valid_from" | "valid_to" | "active">>;
  /** Active products by id (inactive or unknown products are not candidates). */
  products: Map<string, { name: string }>;
  /** Product ids in an active campaign that targets this rep, account category or territory, with the campaign title. */
  campaignProducts: Map<string, string>;
  /** Product ids named in a deal or task linked to an open problem of the account. */
  problemProducts: Set<string>;
  /** Push products marked brief_not_useful at this account in the last 30 days (REQ-MTG-008). */
  feedbackSkip: Set<string>;
  /** Products this account ordered in the last 30 days. */
  recentlyOrdered: Set<string>;
}
export interface Hints { push: Hint | null; avoid: Hint | null; skipped: Array<{ product_id: string; why: "feedback" | "recent_order" | "avoid" }> }

/** Code picks push and avoid; the LLM never does (REQ-MTG-003). */
export function chooseHints(x: HintInput): Hints {
  const live = x.guidance.filter((g) => g.active === true && (!g.valid_from || g.valid_from <= x.today) && (!g.valid_to || g.valid_to >= x.today)
    && (!g.category_id || g.category_id === x.category_id) && x.products.has(g.product_id));
  const name = (id: string) => x.products.get(id)!.name;
  const byScore = (a: Hint, b: Hint) => b.score - a.score || a.name.localeCompare(b.name);
  const avoid = live.filter((g) => g.stance === "avoid")
    .map((g): Hint => ({ product_id: g.product_id, name: name(g.product_id), reason: g.reason, guidance_id: g.id, score: Number(g.priority) }))
    .sort(byScore)[0] ?? null;
  const avoidIds = new Set(live.filter((g) => g.stance === "avoid").map((g) => g.product_id));
  const skipped: Hints["skipped"] = [];
  const push = live.filter((g) => g.stance === "push").filter((g) => {
    if (avoidIds.has(g.product_id)) { skipped.push({ product_id: g.product_id, why: "avoid" }); return false; }     // avoid wins
    if (x.feedbackSkip.has(g.product_id)) { skipped.push({ product_id: g.product_id, why: "feedback" }); return false; }
    if (x.recentlyOrdered.has(g.product_id)) { skipped.push({ product_id: g.product_id, why: "recent_order" }); return false; }
    return true;
  }).map((g): Hint => {
    const campaign = x.campaignProducts.get(g.product_id);
    const paired = x.problemProducts.has(g.product_id);
    const extra = [campaign ? `campaign: ${campaign}` : "", paired ? "fits the open problem" : ""].filter(Boolean);
    return {
      product_id: g.product_id, name: name(g.product_id), guidance_id: g.id,
      reason: extra.length ? `${g.reason} (${extra.join("; ")})` : g.reason,
      score: Number(g.priority) + (campaign ? CAMPAIGN_BOOST : 0) + (paired ? PROBLEM_BOOST : 0),
    };
  }).sort(byScore)[0] ?? null;
  return { push, avoid, skipped };
}

const msOf = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v < 1e11 ? v * 1000 : v;
  if (typeof v === "string" && v) { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  return null;
};

/** Reads the rows metrics.md#visit-brief-hints needs and runs chooseHints. */
export async function loadHints(db: Db, args: { account: Row<"account">; repId: string; day: string; now: number; org: { timezone: string } }): Promise<Hints & { input: HintInput }> {
  const { account, day } = args;
  const [guidance, products, campaigns, problems, deals, tasks, feedback, orders] = await Promise.all([
    db.product_guidance.all({ active: true }),
    db.product.all({ active: true }),
    db.campaign.all({ status: "active" }),
    db.problem.all({ account_id: account.id, status: ["open", "in_progress"] }),
    db.deal.all({ account_id: account.id }),
    db.task.all({ account_id: account.id, status: "open" }),
    db.rep_feedback.all({ account_id: account.id, kind: "brief_not_useful" }),
    db.sales_order.all({ account_id: account.id, order_date: { op: "gte", value: addDays(day, -RECENT_ORDER_DAYS) } } as any),
  ]);
  const productMap = new Map(products.map((p) => [p.id, { name: p.name }]));
  const plist = products.map((p) => ({ id: p.id, name: p.name }));

  // campaigns: active today, targeting this rep, the account's category or territory (no target rows = everyone)
  const live = campaigns.filter((c) => (!c.starts_on || c.starts_on <= day) && (!c.ends_on || c.ends_on >= day));
  const campaignProducts = new Map<string, string>();
  if (live.length) {
    const ids = live.map((c) => c.id);
    const [cp, cr, cc, ct] = await Promise.all([
      db.campaign_product.all({ campaign_id: ids }), db.campaign_rep.all({ campaign_id: ids }),
      db.campaign_category.all({ campaign_id: ids }), db.campaign_territory.all({ campaign_id: ids }),
    ]);
    for (const c of [...live].sort((a, b) => a.title.localeCompare(b.title))) {
      const r = cr.filter((x) => x.campaign_id === c.id), k = cc.filter((x) => x.campaign_id === c.id), t = ct.filter((x) => x.campaign_id === c.id);
      const targets = (!r.length && !k.length && !t.length) || r.some((x) => x.user_id === args.repId)
        || k.some((x) => x.category_id === account.category_id) || t.some((x) => x.territory_id === account.territory_id);
      if (!targets) continue;
      for (const p of cp.filter((x) => x.campaign_id === c.id)) if (!campaignProducts.has(p.product_id)) campaignProducts.set(p.product_id, c.title);
    }
  }

  // open problem -> products named in the account's open deals and tasks
  const problemProducts = new Set<string>();
  if (problems.length) {
    const texts = [...deals.filter((d) => !d.closed_at).map((d) => d.title), ...tasks.map((t) => t.title)];
    for (const t of texts) for (const id of productsMentioned(t, plist)) problemProducts.add(id);
  }

  // feedback: brief_not_useful in the last 30 days (age from created_at, else the linked brief's generated_at; unknown = recent)
  const cutoff = args.now - FEEDBACK_DAYS * 86_400_000;
  const briefIds = [...new Set(feedback.map((f) => f.visit_brief_id).filter((x): x is string => !!x))];
  const briefs = briefIds.length ? await db.visit_brief.all({ id: briefIds } as any) : [];
  const feedbackSkip = new Set<string>();
  for (const f of feedback) {
    const b = f.visit_brief_id ? briefs.find((x) => x.id === f.visit_brief_id) : undefined;
    const pid = f.product_id ?? b?.push_product_id ?? null;
    const at = msOf(f.created_at) ?? msOf(b?.generated_at);
    if (pid && (at === null || at >= cutoff)) feedbackSkip.add(pid);
  }

  // orders in the last 30 days (any status but cancelled)
  const recent = orders.filter((o) => o.status !== "cancelled" && o.order_date >= addDays(day, -RECENT_ORDER_DAYS) && o.order_date <= day);
  const lines = recent.length ? await db.order_line.all({ order_id: recent.map((o) => o.id) }) : [];
  const recentlyOrdered = new Set(lines.map((l) => l.product_id));

  const input: HintInput = { today: day, category_id: account.category_id ?? null, guidance, products: productMap, campaignProducts, problemProducts, feedbackSkip, recentlyOrdered };
  return { ...chooseHints(input), input };
}

// ---------------------------------------------------------------------------------------------- facts + deterministic wording
export type Fact = BulletsInput["facts"][number];
type Lang = "el" | "en";
const T = {
  en: { why: "Why", problem: "Open problem", promise: "Promise", usual: "Usually", last: "last order", ago: (n: number) => (n === 0 ? "today" : n === 1 ? "1 day ago" : `${n} days ago`), noOrders: "No confirmed orders yet", push: "Push", avoid: "Avoid", routine: "routine visit" },
  el: { why: "Γιατί", problem: "Ανοιχτό θέμα", promise: "Υπόσχεση", usual: "Συνήθως", last: "τελευταία παραγγελία", ago: (n: number) => (n === 0 ? "σήμερα" : n === 1 ? "πριν 1 μέρα" : `πριν ${n} μέρες`), noOrders: "Καμία επιβεβαιωμένη παραγγελία ακόμα", push: "Πρότεινε", avoid: "Απόφυγε", routine: "τακτική επίσκεψη" },
};
const clip = (s: string, n = MAX_BULLET_WORDS) => { const w = words(s); return w.length <= n ? s : `${w.slice(0, n).join(" ")}…`; };
const firstClause = (s: string) => s.split(/[;(]/)[0]!.trim();

export interface BriefFacts { facts: Fact[]; bullets: Array<Bullet & { role: string }> }

/** Facts for the LLM and the code-built bullets, both from the visit card (same rows, same numbers). */
export function briefFacts(a: { lang: Lang; visit: Row<"visit">; card: VisitCard; usual: ReturnType<typeof usualItems>; push: Hint | null; avoid: Hint | null; startLocal: string | null }): BriefFacts {
  const t = T[a.lang], c = a.card;
  const facts: Fact[] = [];
  const bullets: BriefFacts["bullets"] = [];
  const purpose = a.visit.purpose?.trim() || null;
  if (purpose) facts.push({ label: "visit_purpose", value: purpose, ref_table: "visit", ref_id: a.visit.id });
  if (a.startLocal) facts.push({ label: "planned_start", value: a.startLocal, ref_table: "visit", ref_id: a.visit.id });
  bullets.push({ role: "why", text: clip(`${t.why}: ${purpose ?? t.routine}`), ref_table: "visit", ref_id: a.visit.id });

  c.open_problems.forEach((p, i) => facts.push({ label: `open_problem_${i + 1}`, value: p.description, ref_table: "problem", ref_id: p.problem_id }));
  const promises = c.open_tasks.filter((x) => x.is_customer_promise);
  promises.forEach((x, i) => facts.push({ label: `promise_${i + 1}`, value: x.title, ref_table: "task", ref_id: x.task_id }));
  const p0 = c.open_problems[0], pr0 = promises[0];
  if (p0) bullets.push({ role: "problem", text: clip(`${t.problem}: ${p0.description}`), ref_table: "problem", ref_id: p0.problem_id });
  else if (pr0) bullets.push({ role: "problem", text: clip(`${t.promise}: ${pr0.title}`), ref_table: "task", ref_id: pr0.task_id });

  a.usual.slice(0, 3).forEach((u, i) => facts.push({ label: `usual_order_${i + 1}`, value: `${u.quantity} ${u.unit} ${u.name}`, ref_table: "product", ref_id: u.product_id }));
  const last = c.recent_orders.find((o) => o.status === "confirmed");
  if (last) facts.push({ label: "last_order", value: `${last.order_date}: ${last.lines.map((l) => `${l.quantity} ${l.unit} ${l.name}`).join(", ")}`, ref_table: "sales_order", ref_id: last.order_id });
  const since = c.metrics.days_since_last_order ?? null, avg = c.metrics.avg_order_interval_days ?? null;
  if (since !== null) facts.push({ label: "days_since_last_order", value: String(since), ref_table: "account_metrics", ref_id: null });
  if (avg !== null) facts.push({ label: "usual_order_interval_days", value: String(avg), ref_table: "account_metrics", ref_id: null });
  c.metrics.risk_reasons.forEach((r, i) => facts.push({ label: `risk_${i + 1}`, value: r, ref_table: "account_metrics", ref_id: null }));
  const u0 = a.usual[0];
  const orderText = [u0 ? `${t.usual} ${u0.quantity} ${u0.unit} ${shortName(u0.name)}` : "", since !== null ? `${t.last} ${t.ago(since)}` : t.noOrders].filter(Boolean).join("; ");
  bullets.push({ role: "orders", text: clip(orderText), ref_table: last ? "sales_order" : null, ref_id: last?.order_id ?? null });

  c.campaigns.forEach((x, i) => facts.push({ label: `campaign_${i + 1}`, value: x.title, ref_table: "campaign", ref_id: x.campaign_id }));
  if (a.push) bullets.push({ role: "push", text: clip(`${t.push} ${shortName(a.push.name)}: ${firstClause(a.push.reason)}`), ref_table: "product_guidance", ref_id: a.push.guidance_id });
  if (a.avoid) bullets.push({ role: "avoid", text: clip(`${t.avoid} ${shortName(a.avoid.name)}: ${firstClause(a.avoid.reason)}`), ref_table: "product_guidance", ref_id: a.avoid.guidance_id });

  const dm = c.contacts.find((x) => x.is_decision_maker) ?? c.contacts[0];
  if (dm) facts.push({ label: "decision_maker", value: `${dm.full_name}${dm.role_title ? ` (${dm.role_title})` : ""}`, ref_table: "contact", ref_id: dm.contact_id });
  const talk = c.how_to_talk?.trim() || "";
  if (talk) facts.push({ label: "how_to_talk", value: talk, ref_table: null, ref_id: null });
  if (talk) bullets.push({ role: "talk", text: clip(talk), ref_table: dm ? "contact" : null, ref_id: dm?.contact_id ?? null });
  return { facts, bullets: bullets.slice(0, MAX_BULLETS) };
}

// ---------------------------------------------------------------------------------------------- LLM output checks
export interface Checked { bullets: Bullet[] | null; script: string | null; rejected: string[] }

/**
 * Contract rules applied in code: a product other than push/avoid (or one already in a fact) rejects the output;
 * a bullet with an ungrounded number or over 15 words is dropped; the bullets are kept only if push and avoid survive.
 */
export function checkOutput(out: BulletsOutput, a: { facts: Fact[]; push: Hint; avoid: Hint; products: Array<{ id: string; name: string }>; sources: string[] }): Checked {
  const rejected: string[] = [];
  const factText = a.facts.map((f) => f.value).join(" \n ");
  const allowed = new Set([a.push.product_id, a.avoid.product_id, ...productsMentioned(factText, a.products)]);
  const sources = [...a.facts.map((f) => f.value), ...a.sources];
  const all = [...out.bullets.map((b) => b.text), out.spoken_script].join(" \n ");
  const foreign = [...productsMentioned(all, a.products)].filter((id) => !allowed.has(id));
  if (foreign.length) return { bullets: null, script: null, rejected: [`names product(s) other than push/avoid: ${foreign.map((id) => a.products.find((p) => p.id === id)!.name).join(", ")}`] };

  const refOf = (labels: string[]) => a.facts.find((f) => labels.includes(f.label) && f.ref_table);
  const kept: Bullet[] = [];
  let hasPush = false, hasAvoid = false;
  for (const b of out.bullets.slice(0, MAX_BULLETS)) {
    const text = b.text.trim();
    if (!text) continue;
    const bad = unknownNumbers(text, sources);
    if (bad.length) { rejected.push(`bullet dropped (ungrounded number ${bad.join(", ")}): ${text}`); continue; }
    if (words(text).length > MAX_BULLET_WORDS) { rejected.push(`bullet dropped (over ${MAX_BULLET_WORDS} words): ${text}`); continue; }
    const named = productsMentioned(text, a.products);
    const isPush = named.has(a.push.product_id), isAvoid = named.has(a.avoid.product_id);
    hasPush ||= isPush; hasAvoid ||= isAvoid;
    const ref = isPush ? { ref_table: "product_guidance", ref_id: a.push.guidance_id } : isAvoid ? { ref_table: "product_guidance", ref_id: a.avoid.guidance_id }
      : (() => { const f = refOf(b.fact_labels ?? []); return { ref_table: f?.ref_table ?? null, ref_id: f?.ref_id ?? null }; })();
    kept.push({ text, ...ref });
  }
  let bullets: Bullet[] | null = kept;
  if (!hasPush || !hasAvoid) { rejected.push(`bullets missing the ${!hasPush ? "push" : "avoid"} product after checks`); bullets = null; }

  let script: string | null = out.spoken_script?.trim() || null;
  const badScript = script ? unknownNumbers(script, sources) : [];
  if (badScript.length) { rejected.push(`script dropped (ungrounded number ${badScript.join(", ")})`); script = null; }
  if (script && words(script).length > MAX_SCRIPT_WORDS) script = fitSpoken(script.match(/[^.!;;?]+[.!;;?]*/g)?.map((x) => x.trim()) ?? [script], MAX_SCRIPT_WORDS);
  return { bullets, script, rejected };
}

const deterministicScript = (accountName: string, bullets: Array<{ text: string }>) =>
  fitSpoken([`${accountName}.`, ...bullets.map((b) => (/[.!?…]$/.test(b.text) ? b.text : `${b.text}.`))], MAX_SCRIPT_WORDS);

// ---------------------------------------------------------------------------------------------- the handler
type BriefOut = Omit<VisitBrief, "push" | "avoid"> & { push?: VisitBrief["push"]; avoid?: VisitBrief["avoid"] };

const visitSummary = (v: Row<"visit">, account: VisitCard["account"], a: Row<"account">): VisitBrief["visit"] => ({
  visit_id: v.id, account, planned_date: v.planned_date, route_position: v.route_position ?? null,
  status: v.status as "planned" | "done" | "skipped", purpose: v.purpose ?? null, reason: null, lat: a.lat ?? null, lng: a.lng ?? null,
});
const accountRef = (a: Row<"account">): VisitCard["account"] => ({ id: a.id, name: a.name, account_type: a.account_type as "prospect" | "customer" | "lost", postal_code: a.postal_code ?? null, city: null, distance_m: null, reason: null });
const iso = (v: unknown): string | null => { const ms = msOf(v); return ms === null ? null : new Date(ms).toISOString(); };

async function findVisit(db: Db, me: Principal, req: { visit_id?: string | null; account_id?: string | null }, day: string, now: number): Promise<{ visit: Row<"visit">; account: Row<"account"> }> {
  if (!!req.visit_id === !!req.account_id) throw invalid("give exactly one of visit_id or account_id");
  if (req.visit_id) {
    const visit = await db.visit.require(req.visit_id);
    return { visit, account: await requireAccount(db, me, visit.account_id) };            // scope (REQ-CORE-009)
  }
  const account = await requireAccount(db, me, req.account_id!);
  const where: Record<string, unknown> = { account_id: account.id, planned_date: day, status: "planned" };
  if (me.kind === "user") where.rep_id = me.id;
  const visits = (await db.visit.all(where as any)).sort((a, b) => String(a.planned_start_at ?? "~").localeCompare(String(b.planned_start_at ?? "~")) || Number(a.route_position ?? 99) - Number(b.route_position ?? 99));
  const next = visits.find((v) => (msOf(v.planned_start_at) ?? Infinity) >= now) ?? visits[0];
  if (!next) throw notFound(`no planned visit at ${account.name} today`, { account_id: account.id, date: day });
  return { visit: next, account };
}

async function storedResponse(db: Db, row: Row<"visit_brief">, visit: Row<"visit">, account: Row<"account">): Promise<BriefOut> {
  const ids = [row.push_product_id, row.avoid_product_id].filter((x): x is string => !!x);
  const products = ids.length ? await db.product.all({ id: ids } as any) : [];
  const hint = (id: string | null | undefined, reason: string | null | undefined) => {
    const p = id ? products.find((x) => x.id === id) : undefined;
    return p ? { product_id: p.id, name: p.name, reason: reason ?? "" } : undefined;
  };
  const out: BriefOut = {
    visit_brief_id: row.id, visit: visitSummary(visit, accountRef(account), account), planned_start_at: iso(visit.planned_start_at),
    bullets: String(row.bullets_text ?? "").split("\n").map((s) => s.trim()).filter(Boolean).map((text) => ({ text, ref_table: null, ref_id: null })),
    spoken_script: row.spoken_script ?? "", status: row.status as VisitBrief["status"], channel: (row.channel ?? null) as VisitBrief["channel"],
  };
  const push = hint(row.push_product_id, row.push_reason), avoid = hint(row.avoid_product_id, row.avoid_reason);
  if (push) out.push = push;
  if (avoid) out.avoid = avoid;
  return out;
}

/** Usual items over the last 180 days of confirmed orders (visit-card-get's rule, imported). */
async function usualOf(db: Db, accountId: string, day: string) {
  const orders = (await db.sales_order.all({ account_id: accountId, status: "confirmed", order_date: { op: "gte", value: addDays(day, -180) } } as any)).filter((o) => o.order_date >= addDays(day, -180));
  if (!orders.length) return [];
  const [lines, products] = await Promise.all([db.order_line.all({ order_id: orders.map((o) => o.id) }), db.product.all({})]);
  const pm = new Map(products.map((p) => [p.id, p]));
  return usualItems(orders.map((o) => ({ lines: lines.filter((l) => l.order_id === o.id).map((l) => ({ product_id: l.product_id, name: pm.get(l.product_id)?.name ?? "?", quantity: Number(l.quantity), unit: pm.get(l.product_id)?.unit ?? "piece" })) })));
}

const NO_LLM = async () => ({ ok: false as const, error: { code: "upstream_failed" as const, message: "pitch not needed for the brief" } as any, attempts: 0, profile: "none", logs: [] });

/** The brief for one visit. Principal may be a system caller (fn:previsit-briefs-due); rows are stamped with the visit's rep. */
export function makeImpl(deps: BriefDeps): Impl<"visit-brief-get", Principal> {
  const log = deps.log ?? ((m: string) => console.warn(m));
  return async ({ req, db, me, platform }) => {
    const now = deps.now?.() ?? Date.now();
    const day = today(me.org, now);
    const { visit, account } = await findVisit(db, me, req, day, now);
    const existing = await db.visit_brief.findOne({ visit_id: visit.id });
    if (existing && !req.regenerate) return (await storedResponse(db, existing, visit, account)) as VisitBrief;

    // facts: the visit card (no pitch LLM call, no KB: the brief only needs its rows)
    const card = (await makeCardImpl({ pitch: NO_LLM, kb: async () => [], now: () => now, log: (m) => { if (!/visit_card_pitch failed/.test(m)) log(m); } })(
      { req: { account_id: account.id } as any, db, me: me as UserPrincipal, platform })) as VisitCard;
    const [hints, usual, rep] = await Promise.all([
      loadHints(db, { account, repId: visit.rep_id, day, now, org: me.org }),
      usualOf(db, account.id, day),
      db.app_user.get(visit.rep_id),
    ]);
    const lang: Lang = String(rep?.preferred_language ?? me.org.default_language ?? "el").toLowerCase().startsWith("en") ? "en" : "el";
    const startLocal = visit.planned_start_at ? localParts(me.org, visit.planned_start_at).time.slice(0, 5) : null;
    const { facts, bullets: codeBullets } = briefFacts({ lang, visit, card, usual, push: hints.push, avoid: hints.avoid, startLocal });

    let bullets: Bullet[] = codeBullets.map(({ role: _r, ...b }) => b);
    let script = deterministicScript(account.name, bullets);
    if (hints.push && hints.avoid) {
      const products = [...hints.input.products.entries()].map(([id, p]) => ({ id, name: p.name }));
      const company_values = await deps.kb(`Why push ${shortName(hints.push.name)} (${hints.push.reason}) and avoid ${shortName(hints.avoid.name)} (${hints.avoid.reason}) at a ${card.kind}? Values and what we never do.`).catch(() => []);
      const input: BulletsInput = {
        language: lang, rep_first_name: words(rep?.full_name ?? "")[0] ?? "", account: card.account, visit_reason: visit.purpose ?? null, facts,
        push: { product_id: hints.push.product_id, name: hints.push.name, reason: hints.push.reason },
        avoid: { product_id: hints.avoid.product_id, name: hints.avoid.name, reason: hints.avoid.reason },
        company_values: company_values.slice(0, 4), how_to_talk_snippets: card.how_to_talk ? [card.how_to_talk] : [], max_bullets: MAX_BULLETS, max_seconds: MAX_SECONDS,
      };
      try {
        const r = await deps.bullets(input);
        if (r.ok) {
          const c = checkOutput(r.value, { facts, push: hints.push, avoid: hints.avoid, products, sources: [hints.push.name, hints.push.reason, hints.avoid.name, hints.avoid.reason, account.name, input.rep_first_name] });
          for (const m of c.rejected) log(`visit-brief-get: ${m}`);
          if (c.bullets?.length) bullets = c.bullets;
          if (c.script) script = c.script;
        } else log(`visit-brief-get: visit_brief_bullets failed (${r.error.code}): ${r.error.message}`);
      } catch (e) { log(`visit-brief-get: visit_brief_bullets threw: ${(e as Error)?.message ?? e}`); }
    } else log(`visit-brief-get: no ${hints.push ? "avoid" : "push"} candidate in product_guidance for ${account.name}; bullet omitted, code wording used`);

    const rowData = {
      visit_id: visit.id, rep_id: visit.rep_id, account_id: account.id,
      bullets_text: bullets.map((b) => b.text).join("\n"), spoken_script: script,
      push_product_id: hints.push?.product_id ?? null, push_reason: hints.push?.reason ?? null, push_guidance_id: hints.push?.guidance_id ?? null,
      avoid_product_id: hints.avoid?.product_id ?? null, avoid_reason: hints.avoid?.reason ?? null, avoid_guidance_id: hints.avoid?.guidance_id ?? null,
      generated_at: new Date(now).toISOString(),
    };
    const row = existing
      ? await db.visit_brief.update(existing.id, rowData as any)
      : await db.visit_brief.insert({ ...rowData, status: "generated", channel: null } as any);

    const out: BriefOut = {
      visit_brief_id: row.id, visit: visitSummary(visit, card.account, account), planned_start_at: iso(visit.planned_start_at),
      bullets, spoken_script: script, status: row.status as VisitBrief["status"], channel: (row.channel ?? null) as VisitBrief["channel"],
    };
    if (hints.push) out.push = { product_id: hints.push.product_id, name: hints.push.name, reason: hints.push.reason };
    if (hints.avoid) out.avoid = { product_id: hints.avoid.product_id, name: hints.avoid.name, reason: hints.avoid.reason };
    return out as VisitBrief;
  };
}

/** Default deps: merc-write LLM + Context Hub KB merc-company via context.api (visit-card-get's KB client). */
export function defaultDeps(api: KbApi | null | undefined, platform: PlatformLike): BriefDeps {
  const ask = kbFromApi(api, platform);
  return {
    bullets: (input) => callStructured("visit_brief_bullets", input, { instructions: BRIEF_INSTRUCTIONS }),
    kb: (q) => ask("merc-company" as any, q),
  };
}

/**
 * The contract response requires push and avoid, but metrics.md#visit-brief-hints rule 5 says a missing candidate is
 * omitted, never invented (change request CR-MTG01-1). The response is validated in full, with only a missing
 * push/avoid tolerated.
 */
export function checkBriefResponse(out: unknown): ReturnType<typeof validateResponse> {
  if (!out || typeof out !== "object" || "error" in (out as object)) return { ok: true, value: out } as any;
  const o = out as Record<string, unknown>;
  const stub = { product_id: "00000000-0000-4000-8000-000000000000", name: "-", reason: "-" };
  return validateResponse("visit-brief-get", { ...o, push: o.push ?? stub, avoid: o.avoid ?? stub });
}

/** Wonderful Function entry (functions/visit-brief-get/index.ts calls this). */
export async function handle(context: FunctionContext & { api?: KbApi | null }) {
  const platform: PlatformLike = { globals: context.globals ?? null };
  const out = await defineFunction("visit-brief-get", makeImpl(defaultDeps(context.api, platform)) as Impl<"visit-brief-get">, { checkResponse: false })(context);
  const v = checkBriefResponse(out);
  return v.ok ? out : { error: { code: "validation_failed", message: "visit-brief-get response breaks its contract", details: { errors: (v as any).errors } } };
}
