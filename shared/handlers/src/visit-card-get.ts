// fn:visit-card-get (contracts/functions/visit-card-get.json, REQ-CRD-001 / REQ-CRD-002).
// A customer card: contacts, open problems, tasks, recent orders, metrics with risk reasons, alerts, campaigns,
// suggested products, how to talk to them and a spoken summary of at most 30 s.
// A prospect card: dossier facts with sources, competitor brands, a pitch with exactly 3 arguments and objections.
// Every number comes from tables via code (REQ-CORE-003). The LLM (visit_card_pitch on merc-write) only writes the
// pitch, objections and "how to talk", grounded in Context Hub snippets (merc-playbook, merc-catalog). When the LLM
// or the knowledge bases are unavailable the card still answers, with a deterministic pitch.
import {
  addDays, daysBetween, defineFunction, globalString, localDate, requireAccount, today,
  type FunctionContext, type Impl, type PlatformLike, type Row, type UserPrincipal, type Db,
} from "../../core/src/index";
import type { FunctionResponseMap } from "../../core/src/generated/contracts/types";
import { callStructured, type CallResult, type LlmInputMap, type LlmOutputMap } from "../../llm/src/index";

export type VisitCard = FunctionResponseMap["visit-card-get"];
export type PitchInput = LlmInputMap["visit_card_pitch"];
export type PitchOutput = LlmOutputMap["visit_card_pitch"];
export type KbName = "merc-catalog" | "merc-playbook";

export interface CardDeps {
  /** One structured visit_card_pitch call (default: shared/llm callStructured on merc-write). */
  pitch(input: PitchInput): Promise<CallResult<PitchOutput>>;
  /** Passages from a Context Hub knowledge base; [] when unavailable. Must not throw. */
  kb(name: KbName, question: string): Promise<string[]>;
  now?: () => number;
  log?: (msg: string) => void;
}

/** 30 s of speech at about 150 words per minute. */
export const MAX_SPOKEN_WORDS = 75;
export const RECENT_ORDERS = 5;
export const PITCH_INSTRUCTIONS = [
  "When pitch is present it has exactly 3 arguments, 1-3 products and 2-4 objections, each with an answer.",
  "For a prospect always return a pitch. For a customer the pitch may be null.",
  "Always return how_to_talk: 1-2 sentences on tone and approach for this shop, without numbers.",
  "suggested_products: 1-3 items, product_id only from the input products list; prefer campaign products.",
  "Ground objections in dossier facts (competitor brands, reviews, prices) and the playbook snippets.",
].join("\n");

// ---------------------------------------------------------------------------------------------- metrics (metrics.md)
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export interface Metrics { avg_order_interval_days: number | null; days_since_last_order: number | null; risk_score: number | null; risk_reasons: string[] }

/** metrics.md usual-frequency + risk, used when tbl:account_metrics has no row yet for the account. */
export function computeMetrics(args: {
  todayDate: string; confirmedOrderDates: string[]; fallbackFrequency: number;
  competitorSignalDates: string[]; openProblemAgesDays: number[]; lastVisitDate: string | null;
}): Metrics {
  const from = addDays(args.todayDate, -180);
  const dates = [...new Set(args.confirmedOrderDates.filter((d) => d >= from && d <= args.todayDate))].sort();
  const avg = dates.length < 3 ? args.fallbackFrequency : median(dates.slice(1).map((d, i) => daysBetween(dates[i]!, d)));
  const since = dates.length ? daysBetween(dates[dates.length - 1]!, args.todayDate) : null;
  let r = 0; const reasons: string[] = [];
  if (since !== null && avg > 0 && since / avg >= 1.5) { r += Math.min(60, Math.round(40 * (since / avg - 1))); reasons.push("order_gap"); }
  if (args.competitorSignalDates.some((d) => d >= addDays(args.todayDate, -30))) { r += 20; reasons.push("competitor"); }
  if (args.openProblemAgesDays.some((a) => a > 7)) { r += 10; reasons.push("open_problem"); }
  if (args.lastVisitDate && daysBetween(args.lastVisitDate, args.todayDate) > 2 * avg) { r += 10; reasons.push("no_visit"); }
  return { avg_order_interval_days: avg, days_since_last_order: since, risk_score: Math.min(100, r), risk_reasons: reasons };
}

/** The usual order: per product the most frequent quantity; ranked by how many orders repeat it (>= 3). */
export function usualItems(orders: Array<{ lines: Array<{ product_id: string; name: string; quantity: number; unit: string }> }>) {
  const by = new Map<string, { name: string; unit: string; qty: Map<number, number> }>();
  for (const o of orders) for (const l of o.lines) {
    const e = by.get(l.product_id) ?? { name: l.name, unit: l.unit, qty: new Map() };
    e.qty.set(l.quantity, (e.qty.get(l.quantity) ?? 0) + 1);
    by.set(l.product_id, e);
  }
  return [...by.entries()]
    .map(([product_id, e]) => { const [quantity, repeats] = [...e.qty.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]!; return { product_id, name: e.name, unit: e.unit, quantity, repeats }; })
    .filter((x) => x.repeats >= 3)
    .sort((a, b) => b.repeats - a.repeats || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------------- spoken summary
const qty = (q: number, unit: string, name: string) => `${q} ${unit === "piece" ? (q === 1 ? "piece" : "pieces") : unit} of ${name}`;
const REASON_TEXT: Record<string, string> = { order_gap: "ordering less often than usual", competitor: "a competitor was seen recently", open_problem: "an old open problem", no_visit: "no recent visit" };

/** Sentences in priority order, cut to MAX_SPOKEN_WORDS (whole sentences). */
export function fitSpoken(sentences: string[], max = MAX_SPOKEN_WORDS): string {
  const out: string[] = []; let words = 0;
  for (const s of sentences.filter(Boolean)) {
    const n = s.split(/\s+/).filter(Boolean).length;
    if (words + n > max) { if (!out.length) out.push(s.split(/\s+/).slice(0, max).join(" ")); break; }
    out.push(s); words += n;
  }
  return out.join(" ");
}

// ---------------------------------------------------------------------------------------------- deterministic fallbacks
type Card = VisitCard;
type Pitch = NonNullable<Card["pitch"]>;
type Product = { product_id: string; name: string };

export function fallbackPitch(a: { name: string; kind: "customer" | "prospect"; brands: string[]; facts: Array<{ fact_type: string; value: string }>; products: Product[]; campaigns: Array<{ title: string }> }): Pitch {
  const review = a.facts.find((f) => f.fact_type === "review_theme")?.value;
  const brand = a.brands[0];
  const p = a.products[0];
  const args = [
    review ? `What customers say about ${a.name}: "${review}". We help keep the coffee consistent at peak.` : `We keep ${a.name}'s coffee consistent with a blend that is forgiving on the grinder.`,
    "One supplier for coffee, milk and takeaway supplies: one weekly delivery and one invoice.",
    p ? `A no-commitment trial of ${p.name} lets the baristas compare it this week${a.campaigns[0] ? ` (${a.campaigns[0].title})` : ""}.` : "A no-commitment trial bag lets the baristas compare it this week.",
  ];
  const objections = [
    ...(brand ? [{ objection: `We are happy with ${brand}.`, answer: `Keep ${brand} for now and try our trial bag side by side for a week; if customers notice no difference, you lose nothing.` }] : []),
    { objection: "It is too expensive.", answer: "Compare cost per cup, not per kilo, and remember delivery and grinder service are included." },
    { objection: "I have no time now.", answer: "Leave the trial bag and ask for five minutes outside peak hours." },
  ];
  return {
    opening_line: review ? `Your customers love ${a.name}; how is the coffee keeping up at peak?` : `How is the coffee going at ${a.name} these days?`,
    arguments: args,
    products: p ? [{ product_id: p.product_id, name: p.name, why: a.campaigns[0] ? `Campaign: ${a.campaigns[0].title}` : "Fits the shop's menu" }] : [],
    objections,
  };
}

/** Keep the LLM's pitch only if it obeys the contract rules (exactly 3 arguments, known products); else null. */
export function cleanPitch(p: PitchOutput["pitch"] | undefined, products: Map<string, string>): Pitch | null {
  if (!p) return null;
  const args = (p.arguments ?? []).map((s) => s.trim()).filter(Boolean);
  if (args.length < 3 || !p.opening_line?.trim()) return null;
  return {
    opening_line: p.opening_line.trim(),
    arguments: args.slice(0, 3),
    products: (p.products ?? []).filter((x) => products.has(x.product_id)).map((x) => ({ product_id: x.product_id, name: products.get(x.product_id)!, why: x.why })),
    objections: (p.objections ?? []).filter((o) => o.objection?.trim() && o.answer?.trim()),
  };
}

// ---------------------------------------------------------------------------------------------- the handler
const lineTotal = (l: Row<"order_line">) => Math.round(Number(l.quantity) * Number(l.unit_price_minor) * (1 - Number(l.discount_pct ?? 0) / 100));
const createdDate = (tz: { timezone: string }, r: { created_at?: number }) => (typeof r.created_at === "number" && r.created_at > 0 ? localDate(tz, r.created_at) : null);

async function activeCampaigns(db: Db, me: UserPrincipal, account: Row<"account">, day: string) {
  const all = (await db.campaign.all({ status: "active" })).filter((c) => (!c.starts_on || c.starts_on <= day) && (!c.ends_on || c.ends_on >= day));
  if (!all.length) return [];
  const ids = all.map((c) => c.id);
  const [terr, reps] = await Promise.all([db.campaign_territory.all({ campaign_id: ids }), db.campaign_rep.all({ campaign_id: ids })]);
  return all.filter((c) => {
    const t = terr.filter((x) => x.campaign_id === c.id), r = reps.filter((x) => x.campaign_id === c.id);
    if (!t.length && !r.length) return true;
    return t.some((x) => x.territory_id === account.territory_id) || r.some((x) => x.user_id === me.id || x.user_id === account.owner_rep_id);
  }).sort((a, b) => a.title.localeCompare(b.title));
}

/** campaign_exposure stage `shown`, once per campaign, account and rep per local day. Best effort. */
async function recordShown(db: Db, me: UserPrincipal, accountId: string, campaignIds: string[], day: string, nowIso: string, log: (m: string) => void) {
  for (const campaign_id of campaignIds) {
    try {
      const prior = await db.campaign_exposure.all({ campaign_id, account_id: accountId, rep_id: me.id, stage: "shown" });
      if (prior.some((e) => e.occurred_at && localDate(me.org, e.occurred_at) === day)) continue;
      await db.campaign_exposure.insert({ campaign_id, account_id: accountId, rep_id: me.id, stage: "shown", occurred_at: nowIso } as any);
    } catch (e) { log(`visit-card-get: campaign_exposure shown not recorded for ${campaign_id}: ${(e as Error)?.message ?? e}`); }
  }
}

export function makeImpl(deps: CardDeps): Impl<"visit-card-get"> {
  const log = deps.log ?? ((m: string) => console.warn(m));
  return async ({ req, db, me }) => {
    const now = deps.now?.() ?? Date.now();
    const day = today(me.org, now);
    const account = await requireAccount(db, me, req.account_id);       // scope (REQ-CORE-009)
    const kind: "customer" | "prospect" = account.account_type === "prospect" ? "prospect" : "customer";

    const [contactsRaw, problemsRaw, tasksRaw, ordersRaw, metricsRow, alertsRaw, productsRaw, dossierRows, category, campaignsRaw] = await Promise.all([
      db.contact.all({ account_id: account.id }),
      db.problem.all({ account_id: account.id, status: ["open", "in_progress"] }),
      db.task.all({ account_id: account.id, status: "open" }),
      db.sales_order.all({ account_id: account.id }, { orderBy: [{ column: "order_date", direction: "desc" }] }),
      db.account_metrics.findOne({ account_id: account.id }),
      db.alert.all({ account_id: account.id, status: "open" }),
      db.product.all({ active: true }),
      db.dossier.all({ account_id: account.id }),
      account.category_id ? db.account_category.get(account.category_id) : Promise.resolve(null),
      activeCampaigns(db, me, account, day),
    ]);
    const products = new Map(productsRaw.map((p) => [p.id, p]));
    const productNames = new Map(productsRaw.map((p) => [p.id, p.name]));

    // orders: recent (any status but draft first by date), lines with names
    const orders = [...ordersRaw].sort((a, b) => (b.order_date ?? "").localeCompare(a.order_date ?? ""));
    const confirmed = orders.filter((o) => o.status === "confirmed");
    const lineOrders = [...orders.slice(0, RECENT_ORDERS), ...confirmed.filter((o) => o.order_date >= addDays(day, -180))];
    const lineIds = [...new Set(lineOrders.map((o) => o.id))];
    const lines = lineIds.length ? await db.order_line.all({ order_id: lineIds }) : [];
    const missing = [...new Set(lines.map((l) => l.product_id).filter((id) => !products.has(id)))];
    for (const p of missing.length ? await db.product.all({ id: missing } as any) : []) products.set(p.id, p);
    const summarize = (o: Row<"sales_order">) => {
      const ls = lines.filter((l) => l.order_id === o.id).sort((a, b) => Number(a.line_no) - Number(b.line_no));
      return {
        order_id: o.id, order_date: o.order_date, status: o.status as "draft" | "confirmed" | "cancelled",
        total_minor: ls.reduce((s, l) => s + lineTotal(l), 0),
        lines: ls.map((l) => ({ product_id: l.product_id, name: products.get(l.product_id)?.name ?? "?", quantity: Number(l.quantity), unit: products.get(l.product_id)?.unit ?? "piece" })),
      };
    };
    const recent_orders = orders.slice(0, RECENT_ORDERS).map(summarize);
    const usual = usualItems(confirmed.filter((o) => o.order_date >= addDays(day, -180)).map(summarize));

    // metrics: the rollup row when present, else metrics.md computed here
    let metrics: Metrics;
    if (metricsRow) {
      metrics = {
        avg_order_interval_days: metricsRow.avg_order_interval_days ?? null,
        days_since_last_order: metricsRow.days_since_last_order ?? null,
        risk_score: metricsRow.risk_score ?? null,
        risk_reasons: String(metricsRow.risk_reasons ?? "").split("|").map((s) => s.trim()).filter(Boolean),
      };
    } else {
      const [signals, visits] = await Promise.all([db.competitor_signal.all({ account_id: account.id }), db.visit.all({ account_id: account.id, status: "done" })]);
      const visitDates = visits.map((v) => (v.completed_at ? localDate(me.org, v.completed_at) : v.planned_date)).filter((d): d is string => !!d && d <= day).sort();
      metrics = computeMetrics({
        todayDate: day,
        confirmedOrderDates: confirmed.map((o) => o.order_date).filter(Boolean),
        fallbackFrequency: Number(account.visit_frequency_days ?? category?.default_visit_frequency_days ?? 14),
        competitorSignalDates: signals.map((s) => (s.observed_at ? localDate(me.org, s.observed_at) : null)).filter((d): d is string => !!d),
        openProblemAgesDays: problemsRaw.map((p) => { const d = createdDate(me.org, p); return d ? daysBetween(d, day) : 8; }),
        lastVisitDate: visitDates[visitDates.length - 1] ?? null,
      });
    }

    // dossier (prospects mostly): latest research, facts with sources, competitor brands
    const dossierRow = [...dossierRows].sort((a, b) => String(b.researched_at ?? "").localeCompare(String(a.researched_at ?? "")))[0] ?? null;
    let dossier: Card["dossier"] = null;
    if (dossierRow) {
      const facts = await db.dossier_fact.all({ dossier_id: dossierRow.id });
      const compIds = [...new Set(facts.map((f) => f.competitor_id).filter((x): x is string => !!x))];
      const comps = compIds.length ? await db.competitor.all({ id: compIds } as any) : [];
      const brands = [...new Set([
        ...facts.filter((f) => f.competitor_id).map((f) => comps.find((c) => c.id === f.competitor_id)?.name).filter((x): x is string => !!x),
        ...facts.filter((f) => f.fact_type === "brand" && !f.competitor_id).map((f) => f.value),
      ])];
      dossier = {
        summary: dossierRow.summary ?? null, price_level: (dossierRow.price_level ?? null) as any,
        facts: facts.filter((f) => f.source_url && f.retrieved_at).map((f) => ({ fact_type: f.fact_type, value: f.value, source_url: f.source_url!, retrieved_at: new Date(f.retrieved_at!).toISOString() })),
        competitor_brands: brands,
      };
    }

    const contacts = [...contactsRaw].sort((a, b) => Number(!!b.is_decision_maker) - Number(!!a.is_decision_maker) || a.full_name.localeCompare(b.full_name))
      .map((c) => ({ contact_id: c.id, full_name: c.full_name, role_title: c.role_title ?? null, is_decision_maker: !!c.is_decision_maker, phone: c.phone ?? null }));
    const open_problems = problemsRaw.map((p) => ({ problem_id: p.id, description: p.description, status: p.status, due_date: p.due_date ?? null }));
    const open_tasks = [...tasksRaw].sort((a, b) => String(a.due_at ?? "9").localeCompare(String(b.due_at ?? "9")))
      .map((t) => ({ task_id: t.id, title: t.title, due_at: t.due_at ? new Date(t.due_at).toISOString() : null, is_customer_promise: !!t.is_customer_promise }));
    const alerts = alertsRaw.map((a) => ({ alert_id: a.id, type: a.alert_type_code, message: a.message ?? a.alert_type_code }));
    const campaigns = campaignsRaw.map((c) => ({ campaign_id: c.id, title: c.title, message: c.message ?? "" }));
    const accountRef = { id: account.id, name: account.name, account_type: account.account_type as "prospect" | "customer" | "lost", postal_code: account.postal_code ?? null, city: null, distance_m: null, reason: null };

    // campaign products first, then usual items, then the rest of the active catalog
    const campaignProducts = campaignsRaw.length ? await db.campaign_product.all({ campaign_id: campaignsRaw.map((c) => c.id) }) : [];
    const ordered = [...new Set([...campaignProducts.map((x) => x.product_id), ...usual.map((u) => u.product_id), ...productsRaw.map((p) => p.id)])].filter((id) => productNames.has(id));
    const llmProducts = ordered.slice(0, 20).map((id) => ({ product_id: id, name: productNames.get(id)! }));

    // grounding: Context Hub passages (never throw)
    const brands = dossier?.competitor_brands ?? [];
    const catName = category?.name ?? "shop";
    const [playbook, catalog] = await Promise.all([
      deps.kb("merc-playbook", `How to pitch and handle objections for a ${catName} ${kind}${brands.length ? ` currently using ${brands.join(", ")}` : ""}${open_problems.length ? ` with an open problem: ${open_problems[0]!.description}` : ""}`).catch(() => []),
      deps.kb("merc-catalog", `Why ${llmProducts.slice(0, 3).map((p) => p.name).join(", ")} fit a ${catName}`).catch(() => []),
    ]);

    const history_facts = [
      ...usual.slice(0, 3).map((u) => `Usual order: ${qty(u.quantity, u.unit, u.name)}`),
      ...(confirmed[0] ? [`Last confirmed order on ${confirmed[0].order_date}`] : kind === "customer" ? ["No confirmed orders yet"] : []),
      ...open_problems.map((p) => `Open problem: ${p.description}`),
      ...open_tasks.filter((t) => t.is_customer_promise).map((t) => `Promise to the customer: ${t.title}`),
      ...metrics.risk_reasons.map((r) => `Risk: ${REASON_TEXT[r] ?? r}`),
    ];
    const input: PitchInput = {
      account: accountRef, kind, dossier, history_facts, memory_snippets: [],
      products: llmProducts, campaigns: campaigns.map((c) => ({ campaign_id: c.campaign_id, title: c.title })),
      playbook_snippets: [...playbook, ...catalog].slice(0, 8),
    };

    let out: PitchOutput | null = null;
    try {
      const r = await deps.pitch(input);
      if (r.ok) out = r.value; else log(`visit-card-get: visit_card_pitch failed (${r.error.code}): ${r.error.message}`);
    } catch (e) { log(`visit-card-get: visit_card_pitch threw: ${(e as Error)?.message ?? e}`); }

    const fbProducts = llmProducts.slice(0, 1);
    let pitch = cleanPitch(out?.pitch, productNames);
    if (pitch && !pitch.objections.length) pitch.objections = fallbackPitch({ name: account.name, kind, brands, facts: dossier?.facts ?? [], products: fbProducts, campaigns }).objections;
    if (!pitch && kind === "prospect") pitch = fallbackPitch({ name: account.name, kind, brands, facts: dossier?.facts ?? [], products: fbProducts, campaigns });

    const why = (id: string) => {
      const c = campaignsRaw.find((cc) => campaignProducts.some((cp) => cp.campaign_id === cc.id && cp.product_id === id));
      if (c) return `Campaign: ${c.title}`;
      const u = usual.find((x) => x.product_id === id);
      return u ? `Usual order: ${qty(u.quantity, u.unit, u.name)}` : "Fits the shop";
    };
    let suggested_products = (out?.suggested_products ?? []).filter((s) => productNames.has(s.product_id))
      .filter((s, i, a) => a.findIndex((x) => x.product_id === s.product_id) === i).slice(0, 3)
      .map((s) => ({ product_id: s.product_id, name: productNames.get(s.product_id)!, why: s.why?.trim() || why(s.product_id) }));
    if (!suggested_products.length) suggested_products = [...new Set([...campaignProducts.map((x) => x.product_id), ...usual.map((u) => u.product_id)])]
      .filter((id) => productNames.has(id)).slice(0, 3).map((id) => ({ product_id: id, name: productNames.get(id)!, why: why(id) }));

    const dm = contacts.find((c) => c.is_decision_maker) ?? contacts[0];
    const how_to_talk = out?.how_to_talk?.trim() || (dm ? `Ask for ${dm.full_name}${dm.role_title ? ` (${dm.role_title})` : ""}; keep it short and come outside peak hours.` : "Keep it short and come outside peak hours.");

    const spoken = kind === "customer"
      ? [
          `${account.name}.`,
          usual[0] ? `They usually order ${qty(usual[0].quantity, usual[0].unit, usual[0].name)}.` : "",
          metrics.days_since_last_order !== null ? `Last order ${metrics.days_since_last_order === 0 ? "today" : metrics.days_since_last_order === 1 ? "yesterday" : `${metrics.days_since_last_order} days ago`}.` : "No confirmed orders yet.",
          ...open_problems.slice(0, 2).map((p) => `Open problem: ${p.description}.`),
          open_tasks.length ? `${open_tasks.length} open task${open_tasks.length > 1 ? "s" : ""}${open_tasks.some((t) => t.is_customer_promise) ? ", including a promise to the customer" : ""}.` : "",
          metrics.risk_reasons.length ? `Watch out: ${metrics.risk_reasons.map((r) => REASON_TEXT[r] ?? r).join(", ")}.` : "",
          alerts[0] ? `Alert: ${alerts[0].message}.` : "",
          campaigns[0] ? `Campaign: ${campaigns[0].title}.` : "",
          suggested_products[0] && !usual.some((u) => u.product_id === suggested_products[0]!.product_id) ? `Suggest ${suggested_products[0].name}.` : "",
        ]
      : [
          `${account.name}, a prospect.`,
          brands.length ? `They currently use ${brands.join(" and ")}.` : "",
          dossier?.summary ? dossier.summary : "",
          pitch ? `Open with: ${pitch.opening_line}` : "",
          campaigns[0] ? `Campaign: ${campaigns[0].title}.` : "",
        ];

    await recordShown(db, me, account.id, campaigns.map((c) => c.campaign_id), day, new Date(now).toISOString(), log);

    return {
      kind, account: accountRef, contacts, open_problems, open_tasks, recent_orders, metrics, alerts,
      suggested_products, campaigns, how_to_talk, dossier, pitch, spoken_summary: fitSpoken(spoken),
    } as Card;
  };
}

// ---------------------------------------------------------------------------------------------- Context Hub access
/** context.api as the runtime gives it (present only when the function has a service account). */
export interface KbApi { get?(path: string, o?: { query?: Record<string, unknown> }): Promise<unknown>; post(path: string, o?: { body?: unknown }): Promise<unknown> }
export const KB_GLOBALS: Record<KbName, string> = { "merc-catalog": "MERC_KB_CATALOG_ID", "merc-playbook": "MERC_KB_PLAYBOOK_ID" };
const unwrap = (x: any): any => (x && typeof x === "object" && "data" in x && !Array.isArray(x) && (x.status !== undefined || x.pagination !== undefined || Object.keys(x).length === 1) ? x.data : x);

/** KB passages via the Context Hub API on context.api; [] (with one log line) when anything is missing or fails. */
export function kbFromApi(api: KbApi | null | undefined, platform: PlatformLike, log: (m: string) => void = (m) => console.warn(m)) {
  const ids = new Map<KbName, string | null>();
  async function idOf(name: KbName): Promise<string | null> {
    if (ids.has(name)) return ids.get(name)!;
    let id = globalString(platform, KB_GLOBALS[name]);
    if (!id && api?.get) {
      const list = unwrap(await api.get("/v1/knowledge-bases"));
      const arr: any[] = Array.isArray(list) ? list : Array.isArray(list?.items) ? list.items : [];
      id = arr.map((k) => k?.kb ?? k).find((k) => k?.name === name)?.id ?? null;
    }
    ids.set(name, id);
    return id;
  }
  return async (name: KbName, question: string): Promise<string[]> => {
    if (!api || typeof api.post !== "function") { log(`visit-card-get: knowledge base ${name} skipped: no service account on this function (context.api unavailable)`); return []; }
    try {
      const id = await idOf(name);
      if (!id) { log(`visit-card-get: knowledge base ${name} not found (set global ${KB_GLOBALS[name]} or create it with infra/kb/apply.sh)`); return []; }
      const res = unwrap(await api.post(`/v1/knowledge-bases/${id}/ask`, { body: { question, top_k: 4, source: "api" } }));
      const results: any[] = Array.isArray(res?.results) ? res.results : [];
      return results.map((r) => String(r?.content ?? "").trim()).filter(Boolean).map((s) => (s.length > 600 ? `${s.slice(0, 600)}…` : s));
    } catch (e) {
      log(`visit-card-get: knowledge base ${name} ask failed: ${(e as Error)?.message ?? e}`);
      return [];
    }
  };
}

/** Wonderful Function entry (functions/visit-card-get/index.ts calls this): merc-write LLM + Context Hub via context.api. */
export function handle(context: FunctionContext & { api?: KbApi | null }) {
  const platform: PlatformLike = { globals: context.globals ?? null };
  return defineFunction("visit-card-get", makeImpl({
    pitch: (input) => callStructured("visit_card_pitch", input, { instructions: PITCH_INSTRUCTIONS }),
    kb: kbFromApi(context.api, platform),
  }))(context);
}
