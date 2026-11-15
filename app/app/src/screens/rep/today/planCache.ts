import { validateResponse, type FunctionResponseMap } from "../../../contracts";
import { readStored, writeStored } from "../../../lib/storage";

export type TodayResult = FunctionResponseMap["today-get"];
export type BriefingResult = FunctionResponseMap["briefing-get"];
export type PlanResult = FunctionResponseMap["visit-plan-get"];
export type PerformanceResult = FunctionResponseMap["my-performance"];

/** Everything the Today screen shows; `today` is the only required part. */
export interface TodayData {
  today: TodayResult;
  briefing: BriefingResult | null;
  plan: PlanResult | null;
  performance: PerformanceResult | null;
}

/** What is stored on the device (REQ-BRF-004: the Today screen works offline from the last cached data). */
export interface CachedToday {
  v: 1;
  savedAt: string;
  data: TodayData;
}

export const TODAY_CACHE_KEY = "merc.today.v1";

/** Storage port so the loader is testable without localStorage. */
export interface TodayCacheStore {
  read(): CachedToday | null;
  write(entry: CachedToday): void;
}

export const createCacheEntry = (data: TodayData, now: Date): CachedToday => ({ v: 1, savedAt: now.toISOString(), data });

const optional = <S extends "briefing-get" | "visit-plan-get" | "my-performance">(slug: S, v: unknown): FunctionResponseMap[S] | null => {
  if (v === null || v === undefined) return null;
  const r = validateResponse(slug, v);
  return r.ok ? (r.value as FunctionResponseMap[S]) : null;
};

/** Parse a stored entry; anything malformed or from another contract version is ignored (never crashes the screen). */
export function parseTodayCache(raw: string | null): CachedToday | null {
  if (!raw) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const e = o as Partial<CachedToday>;
  if (e.v !== 1 || typeof e.savedAt !== "string" || !e.data || typeof e.data !== "object") return null;
  const today = validateResponse("today-get", e.data.today);
  if (!today.ok) return null;
  return {
    v: 1,
    savedAt: e.savedAt,
    data: {
      today: today.value,
      briefing: optional("briefing-get", e.data.briefing),
      plan: optional("visit-plan-get", e.data.plan),
      performance: optional("my-performance", e.data.performance),
    },
  };
}

/** The device cache in localStorage (one rep per phone). */
export function createLocalTodayCache(key = TODAY_CACHE_KEY): TodayCacheStore {
  return {
    read: () => parseTodayCache(readStored(key)),
    write: (entry) => writeStored(key, JSON.stringify(entry)),
  };
}

/** In-memory cache for tests and hosts without storage. */
export function createMemoryTodayCache(initial: CachedToday | null = null): TodayCacheStore & { entry: CachedToday | null } {
  const store = {
    entry: initial,
    read: () => store.entry,
    write: (e: CachedToday) => {
      store.entry = e;
    },
  };
  return store;
}
