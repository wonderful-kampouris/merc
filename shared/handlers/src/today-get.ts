// fn:today-get (contracts/functions/today-get.json, REQ-BRF-004 server side): the caller's stops for a date (default:
// today in the org timezone) in route order, the briefing id if one exists, and how many of their voice logs are
// still in flight server-side. The app caches this response for offline use.
import { defineFunction, today, type Impl, type Row } from "../../core/src/index";
import type { VisitSummary } from "../../core/src/generated/contracts/types";

const IN_FLIGHT = ["uploaded", "transcribing", "processing", "needs_confirmation"] as const;
const int = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null);

export function visitSummary(v: Row<"visit">, a: Row<"account"> | undefined): VisitSummary {
  return {
    visit_id: v.id,
    account: { id: v.account_id, name: a?.name ?? "?", account_type: (a?.account_type ?? "customer") as VisitSummary["account"]["account_type"], postal_code: a?.postal_code ?? null },
    planned_date: v.planned_date,
    route_position: int(v.route_position),
    status: v.status as VisitSummary["status"],
    purpose: v.purpose ?? null,
    reason: v.status === "skipped" ? (v.skip_reason ?? null) : (v.purpose ?? null),
    lat: a?.lat ?? null,
    lng: a?.lng ?? null,
  };
}

export function makeImpl(deps: { now?: () => number } = {}): Impl<"today-get"> {
  return async ({ req, db, me }) => {
    const date = req.date ?? today(me.org, deps.now?.() ?? Date.now());
    const visits = await db.visit.all({ rep_id: me.id, planned_date: date });
    const accounts = new Map((visits.length ? await db.account.all({ id: [...new Set(visits.map((v) => v.account_id))] }) : []).map((a) => [a.id, a]));
    visits.sort((x, y) => (x.route_position ?? 1e9) - (y.route_position ?? 1e9) || (accounts.get(x.account_id)?.name ?? "").localeCompare(accounts.get(y.account_id)?.name ?? "") || x.id.localeCompare(y.id));
    const briefing = await db.briefing.findOne({ rep_id: me.id, briefing_date: date });
    const pending = await db.voice_log.count({ rep_id: me.id, status: [...IN_FLIGHT] });
    return { date, visits: visits.map((v) => visitSummary(v, accounts.get(v.account_id))), briefing_id: briefing?.id ?? null, pending_recordings_hint: pending };
  };
}

export const impl = makeImpl();
/** Wonderful Function entry (functions/today-get/index.ts calls this). */
export const handle = defineFunction("today-get", impl);
