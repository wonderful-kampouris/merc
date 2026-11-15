import type { Directory } from "../dashboard/shared/directory";
import { daysAgo } from "../dashboard/shared/period";
import { shortId } from "../dashboard/shared/format";

/** A competitor-signals-list item (contract: `items: object[]`, tbl:competitor_signal plus optional joins). */
export interface Signal {
  id: string;
  competitor_id: string;
  competitor: string;
  account_id?: string;
  account: string;
  territory_id?: string;
  territory?: string;
  statement: string;
  price_delta_pct: number | null;
  observed_at?: string;
  reporter?: string;
}

const s = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const nested = (v: unknown, k: string): string | undefined => (v && typeof v === "object" ? s((v as Record<string, unknown>)[k]) : undefined);

/** Normalize a loosely typed row, labelling ids from the row's joins first, then the directory. */
export function toSignal(row: Record<string, unknown>, dir: Pick<Directory, "name" | "accountTerritory">): Signal {
  const competitor_id = s(row.competitor_id) ?? nested(row.competitor, "id") ?? "";
  const account_id = s(row.account_id) ?? nested(row.account, "id");
  const territory_id = s(row.territory_id) ?? nested(row.territory, "id") ?? dir.accountTerritory(account_id);
  const reporterId = s(row.reported_by) ?? nested(row.reported_by, "id");
  return {
    id: s(row.id) ?? `${competitor_id}-${s(row.observed_at) ?? ""}`,
    competitor_id,
    competitor: s(row.competitor_name) ?? nested(row.competitor, "name") ?? dir.name("competitor", competitor_id) ?? shortId(competitor_id),
    account_id,
    account: s(row.account_name) ?? nested(row.account, "name") ?? dir.name("account", account_id) ?? shortId(account_id),
    territory_id,
    territory: s(row.territory_name) ?? nested(row.territory, "name") ?? dir.name("territory", territory_id),
    statement: s(row.statement) ?? "",
    price_delta_pct: typeof row.price_delta_pct === "number" ? row.price_delta_pct : null,
    observed_at: s(row.observed_at),
    reporter: s(row.reported_by_name) ?? nested(row.reported_by, "full_name") ?? dir.name("user", reporterId),
  };
}

export interface Bucket {
  id: string;
  name: string;
  count: number;
  /** Mean price_delta_pct over signals that have one; null when none do. */
  avgDelta: number | null;
  /** Count as a share of the largest bucket, 0-100. */
  share: number;
}

/** Count signals per key (competitor or territory), largest first. */
export function bucket(signals: readonly Signal[], key: (x: Signal) => { id: string; name: string }): Bucket[] {
  const m = new Map<string, { name: string; count: number; sum: number; n: number }>();
  for (const x of signals) {
    const k = key(x);
    const b = m.get(k.id) ?? { name: k.name, count: 0, sum: 0, n: 0 };
    b.count++;
    if (x.price_delta_pct !== null) {
      b.sum += x.price_delta_pct;
      b.n++;
    }
    m.set(k.id, b);
  }
  const max = Math.max(0, ...[...m.values()].map((b) => b.count));
  return [...m]
    .map(([id, b]) => ({ id, name: b.name, count: b.count, avgDelta: b.n ? Math.round((10 * b.sum) / b.n) / 10 : null, share: max ? Math.round((100 * b.count) / max) : 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const byCompetitor = (xs: readonly Signal[]) => bucket(xs, (x) => ({ id: x.competitor_id, name: x.competitor }));
export const byTerritory = (xs: readonly Signal[], none: string) => bucket(xs, (x) => ({ id: x.territory_id ?? "-", name: x.territory ?? none }));

/** Newest first. */
export const newestFirst = (xs: readonly Signal[]): Signal[] => [...xs].sort((a, b) => (b.observed_at ?? "").localeCompare(a.observed_at ?? ""));

export type Since = 30 | 90 | 365 | null;
export const SINCE: readonly Since[] = [30, 90, 365, null];

/** competitor-signals-list request (scalar GET params; unset filters are omitted). */
export function listRequest(f: { competitorId: string | null; territoryId: string | null; since: Since }, today?: Date) {
  const from = daysAgo(f.since, today);
  return {
    limit: 200,
    ...(f.competitorId ? { competitor_id: f.competitorId } : {}),
    ...(f.territoryId ? { territory_id: f.territoryId } : {}),
    ...(from ? { from } : {}),
  };
}

/**
 * Client-side guard for the same filters, so the view stays right if the function ignores one
 * (and in mock mode, where the contract mock returns sample rows for any filter).
 */
export function applyFilters(xs: readonly Signal[], f: { competitorId: string | null; territoryId: string | null; since: Since }, today?: Date): Signal[] {
  const from = daysAgo(f.since, today);
  return xs.filter((x) => (!f.competitorId || x.competitor_id === f.competitorId) && (!f.territoryId || x.territory_id === f.territoryId) && (!from || !x.observed_at || x.observed_at.slice(0, 10) >= from));
}
