import type { FunctionRequestMap, OrderSummary, VisitCard } from "../../../contracts";
import type { Lang } from "../../../lib/i18n";

export type AccountFilter = "all" | "customer" | "prospect" | "at_risk";
export const ACCOUNT_FILTERS: readonly AccountFilter[] = ["all", "customer", "prospect", "at_risk"];

/** accounts-list GET params: scalars only, empty values left out. */
export function accountsRequest(q: string, filter: AccountFilter, limit = 50): FunctionRequestMap["accounts-list"] {
  const req: FunctionRequestMap["accounts-list"] = { limit };
  const query = q.trim();
  if (query) req.q = query;
  if (filter === "customer" || filter === "prospect") req.account_type = filter;
  if (filter === "at_risk") req.at_risk = true;
  return req;
}

export type RiskLevel = "none" | "low" | "medium" | "high";

/** Risk score is 0-100 (contracts/metrics.md#risk). Bands for display only. */
export function riskLevel(score: number | null | undefined): RiskLevel {
  if (typeof score !== "number" || !Number.isFinite(score)) return "none";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

/** Reason codes of metrics.md#risk; anything else is already text and shown as is. */
export const RISK_REASON_CODES = ["order_gap", "competitor", "open_problem", "no_visit"] as const;
export type RiskReasonCode = (typeof RISK_REASON_CODES)[number];
export const isRiskReasonCode = (r: string): r is RiskReasonCode => (RISK_REASON_CODES as readonly string[]).includes(r);

/** risk_reasons may arrive as codes or as one pipe-separated string (account_metrics storage form). */
export function splitReasons(reasons: readonly string[]): string[] {
  return reasons.flatMap((r) => r.split("|")).map((r) => r.trim()).filter(Boolean);
}

export interface UsualLine {
  product_id: string;
  name: string;
  quantity: number;
  unit: string;
  /** In how many of the confirmed orders the product appears. */
  orders: number;
}

/**
 * The usual order from the card's recent confirmed orders: products in at least half of them,
 * with their median quantity, most frequent first. ("12 kg Espresso Classico" for Café Miltos.)
 */
export function usualOrder(orders: readonly OrderSummary[]): UsualLine[] {
  const confirmed = orders.filter((o) => o.status === "confirmed");
  if (!confirmed.length) return [];
  const by = new Map<string, { name: string; unit: string; qty: number[] }>();
  for (const o of confirmed) {
    const perOrder = new Map<string, { name: string; unit: string; q: number }>();
    for (const l of o.lines) {
      const cur = perOrder.get(l.product_id);
      perOrder.set(l.product_id, { name: l.name, unit: l.unit, q: (cur?.q ?? 0) + l.quantity });
    }
    for (const [id, l] of perOrder) {
      const e = by.get(id) ?? { name: l.name, unit: l.unit, qty: [] };
      e.qty.push(l.q);
      by.set(id, e);
    }
  }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  return [...by.entries()]
    .filter(([, e]) => e.qty.length * 2 >= confirmed.length)
    .map(([product_id, e]) => ({ product_id, name: e.name, unit: e.unit, quantity: median(e.qty), orders: e.qty.length }))
    .sort((a, b) => b.orders - a.orders || b.quantity - a.quantity || a.name.localeCompare(b.name));
}

/** Lines for order-upsert from a previous order: same products and quantities, list prices (no price, no discount). */
export function reorderLines(order: OrderSummary): FunctionRequestMap["order-upsert"]["lines"] {
  return order.lines.filter((l) => l.quantity > 0).map((l) => ({ product_id: l.product_id, quantity: l.quantity }));
}

/** Spoken length at ~2.5 words per second (Greek and English TTS pace); REQ-CRD-001 caps the summary at 30 s. */
export const WORDS_PER_SECOND = 2.5;
export function spokenSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / WORDS_PER_SECOND);
}

export const isOpenProblem = (status: string): boolean => status !== "resolved";

/** Next status the rep can set on a problem from the card. */
export function problemActions(status: string): Array<"in_progress" | "resolved"> {
  if (status === "resolved") return [];
  if (status === "in_progress") return ["resolved"];
  return ["in_progress", "resolved"];
}

export interface ContactDraft {
  full_name: string;
  role_title: string;
  phone: string;
}
export type ContactErrors = Partial<Record<keyof ContactDraft, "nameRequired" | "phoneInvalid">>;

export function validateContact(d: ContactDraft): ContactErrors {
  const errors: ContactErrors = {};
  if (!d.full_name.trim()) errors.full_name = "nameRequired";
  const phone = d.phone.replace(/[\s\-().]/g, "");
  if (phone && !/^\+?\d{7,15}$/.test(phone)) errors.phone = "phoneInvalid";
  return errors;
}

/** contact-upsert body for a new contact; empty optional fields are left out. */
export function contactRequest(accountId: string, d: ContactDraft): FunctionRequestMap["contact-upsert"] {
  const fields: Record<string, string> = { full_name: d.full_name.trim() };
  if (d.role_title.trim()) fields.role_title = d.role_title.trim();
  const phone = d.phone.replace(/[\s\-().]/g, "");
  if (phone) fields.phone = phone;
  return { contact_id: null, account_id: accountId, fields };
}

/** Host name of a source URL for a compact link label; the raw value when it is not a URL. */
export function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
export const isHttpUrl = (url: string): boolean => /^https?:\/\//i.test(url);

export const pitchArgumentCount = (card: VisitCard): number | null => (card.pitch ? card.pitch.arguments.length : null);

const locale = (lang: Lang) => (lang === "el" ? "el-GR" : "en-GB");
export function formatDate(date: string, lang: Lang): string {
  const d = new Date(date.length === 10 ? `${date}T12:00:00` : date);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short" }).format(d);
}
export function formatQuantity(q: number, unit: string, lang: Lang): string {
  return `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 2 }).format(q)} ${unit}`.trim();
}
export function formatKm(meters: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 1 }).format(meters / 1000);
}
