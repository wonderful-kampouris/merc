import { validateResponse, type FunctionResponseMap } from "../../../contracts";
import { readStored, writeStored } from "../../../lib/storage";

export type TodayResult = FunctionResponseMap["today-get"];
export type BriefingResult = FunctionResponseMap["briefing-get"];
export type PlanResult = FunctionResponseMap["visit-plan-get"];
export type PerformanceResult = FunctionResponseMap["my-performance"];

/** One open task as tasks-list returns it (tbl:task columns plus account name and an overdue flag). */
export interface TaskItem {
  task_id: string;
  title: string;
  status: string;
  due_at: string | null;
  overdue: boolean;
  is_customer_promise?: boolean;
  account_id: string | null;
  account_name: string | null;
}

/** Keep only well-formed task rows (tasks-list items are untyped objects in the contract). */
export function parseTasks(v: unknown): TaskItem[] | null {
  if (!v || typeof v !== "object") return null;
  const items = Array.isArray(v) ? v : (v as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  return items
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as { title?: unknown }).title === "string")
    .map((x) => ({
      task_id: String(x.task_id ?? x.id ?? ""),
      title: String(x.title),
      status: String(x.status ?? "open"),
      due_at: typeof x.due_at === "string" ? x.due_at : null,
      overdue: x.overdue === true,
      is_customer_promise: x.is_customer_promise === true,
      account_id: typeof x.account_id === "string" ? x.account_id : null,
      account_name: typeof x.account_name === "string" ? x.account_name : null,
    }))
    .filter((x) => x.task_id);
}

/** Everything the Today screen shows; `today` is the only required part. */
export interface TodayData {
  today: TodayResult;
  briefing: BriefingResult | null;
  plan: PlanResult | null;
  performance: PerformanceResult | null;
  /** Open tasks, soonest due first. */
  tasks?: TaskItem[] | null;
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
      tasks: parseTasks(e.data.tasks),
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
