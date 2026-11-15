import type { ApiError } from "../../../contracts";
import { MercApiError, type MercClient } from "../../../lib/client";
import { createCacheEntry, type TodayCacheStore, type TodayData } from "./planCache";
import { dataForDate, localDate } from "./todayModel";

export type TodaySource = "live" | "cache";

export interface TodayLoad {
  data: TodayData;
  source: TodaySource;
  /** When the shown data was fetched (cache) or now (live). */
  savedAt: string;
  /** The cache is from another day and has no plan for today. */
  stale: boolean;
  /** Why the live fetch was not used: "offline" or the error code. */
  fallbackReason: "offline" | ApiError["code"] | null;
  /** Secondary sections that failed live (briefing, plan, performance); shown from cache when possible. */
  failed: Array<"briefing" | "plan" | "performance">;
}

export class TodayUnavailableError extends Error {
  constructor(
    readonly reason: "offline" | ApiError["code"],
    message: string,
  ) {
    super(message);
    this.name = "TodayUnavailableError";
  }
}

const codeOf = (e: unknown): ApiError["code"] => (e instanceof MercApiError ? e.code : "upstream_failed");

export interface LoadTodayOptions {
  cache: TodayCacheStore;
  online: boolean;
  now: Date;
}

function fromCache(opts: LoadTodayOptions, reason: TodayLoad["fallbackReason"], err?: unknown): TodayLoad {
  const entry = opts.cache.read();
  if (!entry) {
    const r = reason ?? "upstream_failed";
    throw new TodayUnavailableError(r, err instanceof Error ? err.message : String(r));
  }
  const { data, stale } = dataForDate(entry.data, localDate(opts.now));
  return { data, source: "cache", savedAt: entry.savedAt, stale, fallbackReason: reason, failed: [] };
}

/**
 * Load the Today screen: today-get is required; briefing, week plan and performance are best effort.
 * Offline, or when today-get fails, the last cached data is shown (REQ-BRF-004). A live load refreshes the cache.
 */
export async function loadToday(client: Pick<MercClient, "call">, opts: LoadTodayOptions): Promise<TodayLoad> {
  if (!opts.online) return fromCache(opts, "offline");
  let today: TodayData["today"];
  try {
    today = await client.call("today-get", {});
  } catch (e) {
    return fromCache(opts, codeOf(e), e);
  }
  const prev = opts.cache.read()?.data ?? null;
  const [briefing, plan, performance] = await Promise.allSettled([
    today.briefing_id ? client.call("briefing-get", { date: today.date }) : Promise.resolve(null),
    client.call("visit-plan-get", {}),
    client.call("my-performance", { period: "week" }),
  ]);
  const failed: TodayLoad["failed"] = [];
  const pick = <T>(r: PromiseSettledResult<T>, name: TodayLoad["failed"][number], cached: T | null): T | null => {
    if (r.status === "fulfilled") return r.value;
    failed.push(name);
    return cached;
  };
  const data: TodayData = {
    today,
    // A cached briefing is only reused for the same day.
    briefing: pick(briefing, "briefing", prev?.briefing?.date === today.date ? prev.briefing : null),
    plan: pick(plan, "plan", prev?.plan ?? null),
    performance: pick(performance, "performance", prev?.performance ?? null),
  };
  const entry = createCacheEntry(data, opts.now);
  opts.cache.write(entry);
  return { data, source: "live", savedAt: entry.savedAt, stale: false, fallbackReason: null, failed };
}
