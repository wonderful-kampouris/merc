import type { CandidateCard, EventType, FunctionRequestMap, MercEvent } from "../../../contracts";

export type BadgeColor = "neutral" | "muted" | "blue" | "green" | "orange" | "red" | "teal" | "purple";
export const getCandidateId = (c: CandidateCard): string => c.candidate_id;

export const KNOWN_STATUS = ["new", "duplicate", "researched", "scored", "added", "dismissed", "failed"] as const;
export const isKnownStatus = (s: string): s is (typeof KNOWN_STATUS)[number] => (KNOWN_STATUS as readonly string[]).includes(s);
export const STATUS_COLOR: Record<(typeof KNOWN_STATUS)[number], BadgeColor> = {
  new: "blue",
  duplicate: "orange",
  researched: "teal",
  scored: "green",
  added: "purple",
  dismissed: "muted",
  failed: "red",
};

/** Add to route / dismiss are offered until the candidate is added, dismissed or known already. */
export const canAdd = (c: CandidateCard): boolean => !["added", "dismissed", "duplicate"].includes(c.status) && !c.duplicate_of;
export const canDismiss = (c: CandidateCard): boolean => !["added", "dismissed"].includes(c.status);

/** Best score first (unscored last), dismissed hidden. */
export function getVisible(items: readonly CandidateCard[]): CandidateCard[] {
  return items
    .filter((c) => c.status !== "dismissed")
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.business_name.localeCompare(b.business_name));
}

const clean = (s: string | undefined | null): string | null => (s && s.trim() ? s.trim() : null);

export function createSearchBody(area: string, category: string): FunctionRequestMap["prospect-search"] | null {
  const area_text = clean(area);
  if (!area_text) return null;
  return { area_text, category_text: clean(category), origin: "manual" };
}

export interface AddForm {
  name: string;
  location: string;
  website: string;
  phone: string;
}
export const EMPTY_ADD: AddForm = { name: "", location: "", website: "", phone: "" };

export function createAddBody(f: AddForm): FunctionRequestMap["candidate-add"] | null {
  const business_name = clean(f.name);
  if (!business_name) return null;
  return { business_name, location_hint: clean(f.location), website: clean(f.website), phone: clean(f.phone) };
}

export const formatScore = (n: number): string => String(Math.round(n));

/** Host of a source URL for the "Source:" line; the raw value when it is not a URL. */
export function getHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export interface ReadySummary {
  searchId: string;
  found: number;
  duplicates: number;
  scored: number;
}
export function getReady(e: MercEvent<EventType>): ReadySummary | null {
  if (e.type !== "candidates.ready") return null;
  const p = (e as MercEvent<"candidates.ready">).payload;
  return { searchId: p.search_id, found: p.found, duplicates: p.duplicates, scored: p.scored };
}
