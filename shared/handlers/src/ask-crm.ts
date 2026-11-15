// fn:ask-crm (contracts/functions/ask-crm.json, REQ-CRD-004): factual CRM questions answered only through
// safe query templates. The LLM (contracts/llm/ask_crm_route.json) only picks a template and its hints;
// every value in `facts` comes from a scoped query (REQ-CORE-003, REQ-CORE-009). No template -> no_data.
import { callStructured, type LlmInputMap, type LlmOutputMap } from "../../llm/src/index";
import {
  addDays, daysBetween, defineFunction, listAccounts, localDate, requireAccount, today,
  type Db, type Impl, type Principal, type Row,
} from "../../core/src/index";
import { findProducts, norm, toItems } from "./product-lookup";
import { between, lineTotalMinor, linesOf, money } from "./my-performance";

export type Route = LlmOutputMap["ask_crm_route"];
export type RouteInput = LlmInputMap["ask_crm_route"];
export type Template = Route["template"];
export type Fact = { label: string; value: string; source: string };
type Out = { template: string; params: Record<string, unknown>; facts: Fact[]; no_data: boolean };

export const TEMPLATES: readonly Template[] = [
  "last_order", "order_history_product", "open_items", "account_overview", "deal_status",
  "visit_history", "competitor_mentions", "top_products", "price_of_product", "unknown",
];
/** Below this router confidence the question is treated as off-template. */
export const MIN_CONFIDENCE = 0.5;
const MAX_FACTS = 20;

// ---- routing -------------------------------------------------------------------------------------
/**
 * Deterministic fallback router, used only when the model call fails. It knows a few unambiguous
 * phrasings in English and Greek and otherwise says "unknown", so it can never widen what is answered.
 */
export function keywordRoute(question: string): Route {
  const q = norm(question);
  const has = (...res: RegExp[]) => res.some((r) => r.test(q));
  const pick = (template: Template): Route => ({ template, params: {}, confidence: 0.6 });
  if (has(/\bhow much\b/, /\bprice\b/, /\bcost/, /ποσο κανει/, /ποσο κοστιζ/, /(^| )τιμη( |$)/)) return pick("price_of_product");
  if (has(/\blast\b.*\border/, /\border.*\blast\b/, /τελευταια παραγγελια/, /ποτε .*παραγγ/, /παραγγ.*τελευταια/)) return pick("last_order");
  if (has(/\bcompetitor/, /ανταγωνισ/)) return pick("competitor_mentions");
  if (has(/\bopen (items|tasks|issues)\b/, /\bpending\b/, /εκκρεμ/)) return pick("open_items");
  if (has(/\bdeal/, /συμφωνια/)) return pick("deal_status");
  if (has(/\bvisit(s|ed)?\b/, /επισκεψ/)) return pick("visit_history");
  if (has(/\b(top|best selling|most ordered)\b/, /περισσοτερο/)) return pick("top_products");
  return { template: "unknown", params: {}, confidence: 0 };
}

export type Router = (input: RouteInput) => Promise<{ route: Route; router: "llm" | "keywords" }>;
/** Default router: the merc-extract model via shared/llm, falling back to keywordRoute if the call fails. */
export const llmRouter: Router = async (input) => {
  const r = await callStructured("ask_crm_route", input);
  return r.ok ? { route: r.value, router: "llm" } : { route: keywordRoute(input.question), router: "keywords" };
};

// ---- resolution ----------------------------------------------------------------------------------
const GENERIC = new Set(["cafe", "bistro", "mini", "market", "bakery", "hotel", "taverna", "bar", "coffee", "fournos", "the", "and", "restaurant", "deli", "patisserie", "espresso", "brunch", "lab", "view", "corner", "beach"]);
const distinctive = (name: string) => norm(name).split(" ").filter((t) => t.length >= 3 && !GENERIC.has(t));

/** The account a question is about: explicit id (scope-checked), else a hint, else a name in the question. */
export async function resolveAccount(db: Db, me: Principal, accountId: string | null | undefined, hint: string | null | undefined, question: string): Promise<Row<"account"> | null> {
  if (accountId) return requireAccount(db, me, accountId);
  const visible = (await listAccounts(db, me, {}, { limit: 1000 })).items;
  const byLen = (a: Row<"account">, b: Row<"account">) => a.name.length - b.name.length || a.name.localeCompare(b.name);
  if (hint && norm(hint)) {
    const h = norm(hint), toks = h.split(" ");
    const hits = visible.filter((a) => { const n = norm(a.name); return n.includes(h) || toks.every((t) => n.includes(t)); });
    if (hits.length) return hits.sort(byLen)[0]!;
  }
  const words = new Set(norm(question).split(" "));
  const scored = visible.map((a) => ({ a, s: distinctive(a.name).filter((t) => words.has(t)).length })).filter((x) => x.s > 0);
  scored.sort((x, y) => y.s - x.s || byLen(x.a, y.a));
  return scored[0]?.a ?? null;
}

/** The product a question is about: the hint through product-lookup, else product name words in the question. */
export async function resolveProduct(db: Db, hint: string | null | undefined, question: string): Promise<Row<"product"> | null> {
  if (hint) { const p = (await findProducts(db, hint, 1))[0]; if (p) return p; }
  const words = new Set(norm(question).split(" "));
  const products = await db.product.all({ active: true });
  const scored = products.map((p) => ({ p, s: norm(p.name).split(" ").filter((t) => t.length >= 3 && !/^\d/.test(t) && words.has(t)).length })).filter((x) => x.s > 0);
  scored.sort((x, y) => y.s - x.s || x.p.name.length - y.p.name.length);
  return scored[0]?.p ?? null;
}

// ---- templates -----------------------------------------------------------------------------------
interface Ctx { db: Db; me: Principal; day: string; account: Row<"account"> | null; product: Row<"product"> | null; from: string | null; to: string | null; limit: number; cur: string }
const fact = (label: string, value: string | number, table: string, id: string): Fact => ({ label, value: String(value), source: `${table}:${id}` });
const visitDay = (c: Ctx, v: Row<"visit">) => (v.completed_at ? localDate(c.me.org, v.completed_at) : v.planned_date ?? "");
const ACCOUNT_TEMPLATES = new Set<Template>(["last_order", "order_history_product", "account_overview", "deal_status", "visit_history", "top_products"]);

async function confirmedOrders(c: Ctx, accountId: string, from: string | null, to: string | null): Promise<Row<"sales_order">[]> {
  const and = [...(from ? [{ column: "order_date", operator: "gte" as const, value: from }] : []), ...(to ? [{ column: "order_date", operator: "lte" as const, value: to }] : [])];
  return db_sorted(await c.db.sales_order.all({ account_id: accountId, status: "confirmed" }, { and }));
}
const db_sorted = (o: Row<"sales_order">[]) => o.sort((a, b) => (b.order_date ?? "").localeCompare(a.order_date ?? ""));

const RUN: Record<Exclude<Template, "unknown">, (c: Ctx) => Promise<Fact[]>> = {
  async last_order(c) {
    const a = c.account!;
    const last = (await confirmedOrders(c, a.id, null, null))[0];
    if (!last?.order_date) return [];
    const total = (await linesOf(c.db, [last.id])).reduce((s, l) => s + lineTotalMinor(l), 0);
    return [
      fact(`${a.name}: last order date`, last.order_date, "sales_order", last.id),
      fact(`${a.name}: days since last order`, daysBetween(last.order_date, c.day), "sales_order", last.id),
      fact(`${a.name}: last order total (${c.cur})`, money(total), "sales_order", last.id),
    ];
  },
  async order_history_product(c) {
    const a = c.account!, p = c.product;
    if (!p) return [];
    const orders = await confirmedOrders(c, a.id, c.from, c.to);
    const lines = (await linesOf(c.db, orders.map((o) => o.id))).filter((l) => l.product_id === p.id);
    const byOrder = new Map(orders.map((o) => [o.id, o]));
    const rows = lines.map((l) => ({ l, o: byOrder.get(l.order_id)! })).sort((x, y) => (y.o.order_date ?? "").localeCompare(x.o.order_date ?? ""));
    if (!rows.length) return [];
    const totalQty = rows.reduce((s, r) => s + r.l.quantity, 0);
    return [
      fact(`${a.name}: ${p.name} total quantity (${p.unit})`, totalQty, "order_line", rows.map((r) => r.l.id).join(",")),
      ...rows.slice(0, c.limit).map((r) => fact(`${p.name} ordered on ${r.o.order_date}`, `${r.l.quantity} ${p.unit}`, "order_line", r.l.id)),
    ];
  },
  async open_items(c) {
    const out: Fact[] = [];
    const tasks = c.account ? await c.db.task.all({ account_id: c.account.id, status: "open" }) : await c.db.task.all({ owner_id: c.me.id, status: "open" });
    for (const t of tasks.sort((x, y) => (x.due_at ?? "~").localeCompare(y.due_at ?? "~"))) out.push(fact(`open task: ${t.title}`, t.due_at ? `due ${localDate(c.me.org, t.due_at)}` : "no due date", "task", t.id));
    if (c.account) {
      for (const p of await c.db.problem.all({ account_id: c.account.id, status: ["open", "in_progress"] })) out.push(fact(`open problem: ${p.description}`, p.due_date ? `${p.status}, due ${p.due_date}` : p.status, "problem", p.id));
      for (const d of await c.db.deal.all({ account_id: c.account.id, closed_at: null })) out.push(fact(`open deal: ${d.title}`, d.stage_code, "deal", d.id));
    }
    return out;
  },
  async account_overview(c) {
    const a = c.account!;
    const out = [fact(`${a.name}: type`, a.account_type, "account", a.id)];
    if (a.customer_since) out.push(fact(`${a.name}: customer since`, a.customer_since, "account", a.id));
    const last = (await confirmedOrders(c, a.id, null, null))[0];
    if (last?.order_date) out.push(fact(`${a.name}: last order date`, last.order_date, "sales_order", last.id));
    const visits = (await c.db.visit.all({ account_id: a.id, status: "done" })).sort((x, y) => visitDay(c, y).localeCompare(visitDay(c, x)));
    if (visits[0]) out.push(fact(`${a.name}: last visit date`, visitDay(c, visits[0]), "visit", visits[0].id));
    const open = await c.db.deal.all({ account_id: a.id, closed_at: null });
    out.push(fact(`${a.name}: open deals`, open.length, "deal", open.map((d) => d.id).join(",") || a.id));
    return out;
  },
  async deal_status(c) {
    const a = c.account!;
    const deals = (await c.db.deal.all({ account_id: a.id })).sort((x, y) => Number(!!x.closed_at) - Number(!!y.closed_at) || (x.expected_close_date ?? "~").localeCompare(y.expected_close_date ?? "~"));
    return deals.slice(0, c.limit).map((d) => fact(`deal: ${d.title}`,
      [`stage ${d.stage_code}`, d.amount_minor != null ? `${money(d.amount_minor)} ${c.cur}` : null, d.expected_close_date ? `expected close ${d.expected_close_date}` : null, d.next_step ? `next step: ${d.next_step}` : null].filter(Boolean).join(", "),
      "deal", d.id));
  },
  async visit_history(c) {
    const a = c.account!;
    const visits = (await c.db.visit.all({ account_id: a.id, status: "done" })).filter((v) => (!c.from || visitDay(c, v) >= c.from) && (!c.to || visitDay(c, v) <= c.to));
    visits.sort((x, y) => visitDay(c, y).localeCompare(visitDay(c, x)));
    return visits.slice(0, c.limit).map((v) => fact(`visit on ${visitDay(c, v)}`, [v.purpose, v.outcome].filter(Boolean).join(": ") || "done", "visit", v.id));
  },
  async competitor_mentions(c) {
    const ids = c.account ? [c.account.id] : (await listAccounts(c.db, c.me, {}, { limit: 1000 })).items.map((a) => a.id);
    const signals: Row<"competitor_signal">[] = [];
    for (let i = 0; i < ids.length; i += 200) signals.push(...(await c.db.competitor_signal.all({ account_id: ids.slice(i, i + 200) })));
    const inRange = signals.filter((s) => { const d = s.observed_at ? localDate(c.me.org, s.observed_at) : ""; return (!c.from || d >= c.from) && (!c.to || d <= c.to); });
    inRange.sort((x, y) => (y.observed_at ?? "").localeCompare(x.observed_at ?? ""));
    const compIds = [...new Set(inRange.map((s) => s.competitor_id).filter((x): x is string => !!x))];
    const names = new Map((compIds.length ? await c.db.competitor.all({ id: compIds }) : []).map((x) => [x.id, x.name]));
    return inRange.slice(0, c.limit).map((s) => fact(
      `${(s.competitor_id && names.get(s.competitor_id)) || "competitor"}${s.observed_at ? ` on ${localDate(c.me.org, s.observed_at)}` : ""}`,
      [s.statement, s.price_delta_pct != null ? `price delta ${s.price_delta_pct}%` : null].filter(Boolean).join(", "), "competitor_signal", s.id));
  },
  async top_products(c) {
    const a = c.account!;
    const from = c.from ?? addDays(c.day, -90), to = c.to ?? c.day;
    const lines = await linesOf(c.db, (await confirmedOrders(c, a.id, from, to)).map((o) => o.id));
    const agg = new Map<string, { qty: number; rev: number; ids: string[] }>();
    for (const l of lines) { const x = agg.get(l.product_id) ?? { qty: 0, rev: 0, ids: [] }; x.qty += l.quantity; x.rev += lineTotalMinor(l); x.ids.push(l.id); agg.set(l.product_id, x); }
    const top = [...agg.entries()].sort((x, y) => y[1].rev - x[1].rev || y[1].qty - x[1].qty).slice(0, c.limit);
    const prods = new Map((top.length ? await c.db.product.all({ id: top.map(([id]) => id) }) : []).map((p) => [p.id, p]));
    return top.map(([id, x]) => { const p = prods.get(id); return fact(`${a.name} ${from}..${to}: ${p?.name ?? "product"}`, `${x.qty} ${p?.unit ?? ""}, ${money(x.rev)} ${c.cur}`.replace(" ,", ","), "product", id); });
  },
  async price_of_product(c) {
    const p = c.product;
    if (!p) return [];
    const [item] = await toItems(c.db, [p], c.day);
    const out = [
      fact(`${p.name}: list price (${c.cur} per ${p.unit})`, money(p.list_price_minor), "product", p.id),
      fact(`${p.name}: unit`, p.unit, "product", p.id),
      fact(`${p.name}: availability`, item!.stock, "product", p.id),
    ];
    if (item!.active_campaigns.length) out.push(fact(`${p.name}: active campaigns`, item!.active_campaigns.join("; "), "campaign_product", p.id));
    return out;
  },
};

// ---- impl ----------------------------------------------------------------------------------------
export interface AskCrmDeps { route?: Router; now?: () => number }
export function makeImpl(deps: AskCrmDeps = {}): Impl<"ask-crm"> {
  const route = deps.route ?? llmRouter;
  return async ({ req, db, me }) => {
    const day = today(me.org, deps.now?.() ?? Date.now());
    // An explicit account id is scope-checked before anything else (REQ-CORE-009).
    const explicit = req.account_id ? await requireAccount(db, me, req.account_id) : null;
    const { route: r, router } = await route({ question: req.question, account_id: req.account_id ?? null, today: day });
    const template: Template = TEMPLATES.includes(r.template) && r.confidence >= MIN_CONFIDENCE ? r.template : "unknown";
    const p = r.params ?? {};
    const params: Record<string, unknown> = { ...p, router, confidence: r.confidence };
    if (template === "unknown") return { template, params, facts: [], no_data: true } satisfies Out;

    const needsProduct = template === "price_of_product" || template === "order_history_product";
    const account = explicit ?? (template === "price_of_product" ? null : await resolveAccount(db, me, null, p.account_hint, req.question));
    const product = needsProduct ? await resolveProduct(db, p.product_hint, req.question) : null;
    params.account_id = account?.id ?? null;
    if (needsProduct) params.product_id = product?.id ?? null;
    if (ACCOUNT_TEMPLATES.has(template) && !account) return { template, params, facts: [], no_data: true } satisfies Out;

    const limit = Math.min(Math.max(p.limit ?? (template === "top_products" ? 3 : 5), 1), MAX_FACTS);
    const facts = (await RUN[template]({ db, me, day, account, product, from: p.from ?? null, to: p.to ?? null, limit, cur: me.org.currency ?? "EUR" })).slice(0, MAX_FACTS);
    return { template, params, facts, no_data: facts.length === 0 } satisfies Out;
  };
}
export const impl = makeImpl();

/** Wonderful Function entry (functions/ask-crm/index.ts calls this). */
export const handle = defineFunction("ask-crm", impl);
