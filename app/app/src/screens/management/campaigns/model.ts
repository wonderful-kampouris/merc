import type { FunctionRequestMap, FunctionResponseMap } from "../../../contracts";
import { addDaysIso, isObj, objArr, num, str, strArr, type Obj } from "../settings/kit";

export type CampaignStatus = "draft" | "active" | "ended";
export const STATUSES: readonly CampaignStatus[] = ["draft", "active", "ended"];
const asStatus = (s: string): CampaignStatus => (STATUSES.includes(s as CampaignStatus) ? (s as CampaignStatus) : "draft");

export interface Links {
  product_ids: string[];
  territory_ids: string[];
  category_ids: string[];
  rep_ids: string[];
}
const LINK_KEYS = ["product_ids", "territory_ids", "category_ids", "rep_ids"] as const;

export interface Campaign {
  id: string;
  title: string;
  message: string;
  starts_on: string;
  ends_on: string;
  status: CampaignStatus;
  /** Present only when campaigns-list returns the link ids; without them an edit would clear the links. */
  links: Links | null;
}

export function parseCampaigns(items: Obj[]): Campaign[] {
  return items
    .filter((o) => str(o, "id") && str(o, "title"))
    .map((o) => {
      const arrs = LINK_KEYS.map((k) => strArr(o, k));
      return {
        id: str(o, "id"),
        title: str(o, "title"),
        message: str(o, "message"),
        starts_on: str(o, "starts_on"),
        ends_on: str(o, "ends_on"),
        status: asStatus(str(o, "status")),
        links: arrs.every((a) => a) ? { product_ids: arrs[0]!, territory_ids: arrs[1]!, category_ids: arrs[2]!, rep_ids: arrs[3]! } : null,
      };
    });
}

export interface ResolvedNames {
  products: string[];
  territories: string[];
  categories: string[];
  reps: string[];
}

export interface CampaignForm extends Links {
  campaign_id: string | null;
  title: string;
  message: string;
  starts_on: string;
  ends_on: string;
  status: CampaignStatus;
  names: ResolvedNames;
}

const noNames = (): ResolvedNames => ({ products: [], territories: [], categories: [], reps: [] });

export function emptyForm(today: string): CampaignForm {
  return {
    campaign_id: null, title: "", message: "", starts_on: today, ends_on: addDaysIso(today, 6), status: "draft",
    product_ids: [], territory_ids: [], category_ids: [], rep_ids: [], names: noNames(),
  };
}

/**
 * campaign-draft-from-text answers a loose `draft` (contracts/llm/campaign_from_text.json output plus resolved ids).
 * Missing title/message fall back to the manager's own words; missing dates to this week.
 */
export function formFromDraft(draft: Obj, text: string, today: string): CampaignForm {
  const base = emptyForm(today);
  const words = text.trim();
  const ids = (k: (typeof LINK_KEYS)[number]) => strArr(draft, k) ?? [];
  return {
    ...base,
    title: str(draft, "title") || words.slice(0, 60),
    message: str(draft, "message") || words,
    starts_on: str(draft, "starts_on") || base.starts_on,
    ends_on: str(draft, "ends_on") || base.ends_on,
    status: STATUSES.includes(str(draft, "status") as CampaignStatus) ? (str(draft, "status") as CampaignStatus) : "draft",
    product_ids: ids("product_ids"), territory_ids: ids("territory_ids"), category_ids: ids("category_ids"), rep_ids: ids("rep_ids"),
    names: {
      products: strArr(draft, "product_names") ?? [],
      territories: strArr(draft, "territory_names") ?? [],
      categories: strArr(draft, "category_names") ?? [],
      reps: strArr(draft, "rep_names") ?? [],
    },
  };
}

export function formFromCampaign(c: Campaign): CampaignForm | null {
  if (!c.links) return null;
  return { campaign_id: c.id, title: c.title, message: c.message, starts_on: c.starts_on, ends_on: c.ends_on, status: c.status, ...c.links, names: noNames() };
}

export type FormProblem = "title" | "message" | "dates" | "order";
export function validateForm(f: CampaignForm): FormProblem[] {
  const out: FormProblem[] = [];
  if (!f.title.trim()) out.push("title");
  if (!f.message.trim()) out.push("message");
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(f.starts_on) || !iso.test(f.ends_on)) out.push("dates");
  else if (f.ends_on < f.starts_on) out.push("order");
  return out;
}

export function toUpsert(f: CampaignForm): FunctionRequestMap["campaign-upsert"] {
  return {
    campaign_id: f.campaign_id,
    title: f.title.trim(),
    message: f.message.trim(),
    starts_on: f.starts_on,
    ends_on: f.ends_on,
    status: f.status,
    product_ids: f.product_ids,
    territory_ids: f.territory_ids,
    category_ids: f.category_ids,
    rep_ids: f.rep_ids,
  };
}

export interface FunnelRep {
  name: string;
  shown: number;
  pitched: number;
  ordered: number;
}
export interface Funnel {
  shown: number;
  pitched: number;
  ordered: number;
  byRep: FunnelRep[];
}
export function parseFunnel(r: FunctionResponseMap["campaign-funnel"]): Funnel {
  return {
    shown: r.shown,
    pitched: r.pitched,
    ordered: r.ordered,
    byRep: objArr(r.by_rep)
      .map((o) => ({
        name: str(o, "full_name") || str(o, "rep_name") || str(o, "name") || str(o, "rep_id"),
        shown: num(o, "shown") ?? 0,
        pitched: num(o, "pitched") ?? 0,
        ordered: num(o, "ordered") ?? 0,
      }))
      .filter((r) => r.name),
  };
}
/** Share of `part` in `whole` as a whole percent; 0 when nothing was shown. */
export const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export const draftOf = (r: FunctionResponseMap["campaign-draft-from-text"]): Obj => (isObj(r.draft) ? r.draft : {});
