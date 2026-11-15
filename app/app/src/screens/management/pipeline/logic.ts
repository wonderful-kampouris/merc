import { seedRows } from "../../../contracts";
import { numberOr, stringOr } from "../dashboard/shared/format";

/** deal_stage lookup (contracts seed): code, display name, order, closed/won flags, probability 0-1. */
export interface Stage {
  code: string;
  name: string;
  sort_order: number;
  is_closed: boolean;
  is_won: boolean;
  probability: number;
}

export const STAGES: readonly Stage[] = seedRows("deal_stage")
  .map((r) => ({
    code: String(r.code),
    name: String(r.name),
    sort_order: numberOr(r.sort_order),
    is_closed: r.is_closed === true,
    is_won: r.is_won === true,
    probability: numberOr(r.probability),
  }))
  .sort((a, b) => a.sort_order - b.sort_order);

const STAGE_EL: Record<string, string> = { new: "Νέα", qualified: "Αξιολογημένη", proposal: "Προσφορά", negotiation: "Διαπραγμάτευση", won: "Κερδισμένη", lost: "Χαμένη" };
export const stageName = (code: string, lang: "el" | "en"): string =>
  lang === "el" ? STAGE_EL[code] ?? code : STAGES.find((s) => s.code === code)?.name ?? code;

/** A deals-list item (contract: `items: object[]`, columns of tbl:deal plus optional joined names). */
export interface Deal {
  id: string;
  account_id: string;
  owner_id?: string;
  stage_code: string;
  title: string;
  amount_minor: number;
  expected_close_date?: string;
  next_step?: string;
  last_activity_at?: string;
  account_name?: string;
  owner_name?: string;
}

const opt = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const nestedName = (v: unknown): string | undefined =>
  v && typeof v === "object" ? opt((v as Record<string, unknown>).name) ?? opt((v as Record<string, unknown>).full_name) : undefined;

/** Normalize one loosely typed deals-list row; rows without id/account are dropped (null). */
export function toDeal(row: Record<string, unknown>): Deal | null {
  const id = opt(row.id) ?? opt(row.deal_id);
  const account_id = opt(row.account_id) ?? opt((row.account as Record<string, unknown> | undefined)?.id);
  if (!id || !account_id) return null;
  return {
    id,
    account_id,
    owner_id: opt(row.owner_id),
    stage_code: stringOr(row.stage_code, "new"),
    title: stringOr(row.title, "—"),
    amount_minor: numberOr(row.amount_minor),
    expected_close_date: opt(row.expected_close_date),
    next_step: opt(row.next_step),
    last_activity_at: opt(row.last_activity_at),
    account_name: opt(row.account_name) ?? nestedName(row.account),
    owner_name: opt(row.owner_name) ?? nestedName(row.owner),
  };
}

export interface StageColumn {
  stage: Stage;
  deals: Deal[];
  amount_minor: number;
  weighted_minor: number;
}

/** Deals grouped by stage in lookup order; unknown stage codes get their own column at the end (probability 0). */
export function groupByStage(deals: readonly Deal[], stages: readonly Stage[] = STAGES): StageColumn[] {
  const cols = new Map<string, StageColumn>();
  for (const s of stages) cols.set(s.code, { stage: s, deals: [], amount_minor: 0, weighted_minor: 0 });
  for (const d of deals) {
    let c = cols.get(d.stage_code);
    if (!c) {
      c = { stage: { code: d.stage_code, name: d.stage_code, sort_order: 999, is_closed: false, is_won: false, probability: 0 }, deals: [], amount_minor: 0, weighted_minor: 0 };
      cols.set(d.stage_code, c);
    }
    c.deals.push(d);
    c.amount_minor += d.amount_minor;
    c.weighted_minor += c.stage.is_closed ? 0 : Math.round(d.amount_minor * c.stage.probability);
  }
  return [...cols.values()];
}

/** metrics.md#weighted-pipeline: `sum(amount_minor x probability)` over deals whose stage is not closed. */
export function weightedPipeline(deals: readonly Deal[], stages: readonly Stage[] = STAGES): number {
  const by = new Map(stages.map((s) => [s.code, s]));
  return deals.reduce((sum, d) => {
    const s = by.get(d.stage_code);
    return s && !s.is_closed ? sum + Math.round(d.amount_minor * s.probability) : sum;
  }, 0);
}

export interface DealFilter {
  q: string;
  stage: string | null;
  owner: string | null;
}

export function filterDeals(deals: readonly Deal[], f: DealFilter, accountName: (id: string) => string | undefined): Deal[] {
  const q = f.q.trim().toLocaleLowerCase();
  return deals.filter(
    (d) =>
      (!f.stage || d.stage_code === f.stage) &&
      (!f.owner || d.owner_id === f.owner) &&
      (!q || d.title.toLocaleLowerCase().includes(q) || (d.account_name ?? accountName(d.account_id) ?? "").toLocaleLowerCase().includes(q)),
  );
}

/** deal-upsert body that moves a deal to another stage (only `stage_code` changes). */
export const moveRequest = (d: Deal, stage_code: string) => ({ deal_id: d.id, account_id: d.account_id, fields: { stage_code } });

export interface NewDealForm {
  account_id: string;
  title: string;
  amount_eur: number | null;
  stage_code: string;
  expected_close_date: string;
  next_step: string;
}

/** deal-upsert body for a new deal, or null when required fields are missing. Euros -> minor units. */
export function newDealRequest(f: NewDealForm): { account_id: string; fields: Record<string, unknown> } | null {
  if (!f.account_id || !f.title.trim() || f.amount_eur === null || !(f.amount_eur > 0)) return null;
  const fields: Record<string, unknown> = { title: f.title.trim(), amount_minor: Math.round(f.amount_eur * 100), stage_code: f.stage_code || "new" };
  if (f.expected_close_date) fields.expected_close_date = f.expected_close_date;
  if (f.next_step.trim()) fields.next_step = f.next_step.trim();
  return { account_id: f.account_id, fields };
}

/** Optimistic local move, so the board updates before the reply. */
export const applyMove = (deals: readonly Deal[], id: string, stage_code: string): Deal[] => deals.map((d) => (d.id === id ? { ...d, stage_code } : d));
