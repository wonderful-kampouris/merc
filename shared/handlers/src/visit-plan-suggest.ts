// fn:visit-plan-suggest (contracts/functions/visit-plan-suggest.json, REQ-PLN-001): Sunday 18:00 cron that proposes
// next week's plan (Mon-Fri) for every active rep, exactly as contracts/metrics.md#visit-plan says:
//   score = +50 visit overdue (+10 per day overdue, cap 30) | +40 open customer-promise task due that week
//           (placed on or before its due day) | +30 x risk_score/100 | +15 active campaign targeting the account's
//           territory/category | +10 prospect added to the route in the last 14 days (max 2 per day)
//   fill days in score order, max organization.visits_per_day per day; each day routed by greedy nearest
//   neighbour from its first (top-scored) stop; route_position = order in that path; reason = top contributor.
// Deterministic: no randomness, every list explicitly sorted, ties broken by account name then id.
// Reps that already have a plan for that week are left alone (idempotent re-runs). dry_run computes and returns
// the plans in details without writing. After writing, plan.proposed is pushed to rep:{id} (needs a service
// account on the function; without one push() logs a warning and the app polls).
import {
  addDays, dayRange, daysBetween, defineCron, localDate, startOfWeek, today, weekday,
  type Db, type FunctionContext, type Impl, type Principal, type Row,
} from "../../core/src/index";
import { push, repChannel, type PushPlatform } from "../../live/src/index";
import { workWeek } from "./visit-plan-get";

export interface Deps { now?: () => number; live?: PushPlatform | null }

export interface Scored {
  account: Row<"account">;
  score: number;
  reason: string;
  /** Allowed day window inside the week (indexes 0..4). */
  earliest: number;
  latest: number;
  recentProspect: boolean;
}
export interface PlannedStop { account_id: string; name: string; date: string; route_position: number; score: number; reason: string }

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Great-circle distance in km (good enough for ordering stops). */
export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Greedy nearest neighbour from the first item; items without coordinates go last in their given order. */
export function routeOrder<T>(items: T[], at: (t: T) => { lat: number; lng: number } | null): T[] {
  const located = items.filter((t) => at(t)), unlocated = items.filter((t) => !at(t));
  if (!located.length) return items;
  const out = [located[0]!];
  const left = located.slice(1);
  while (left.length) {
    const cur = at(out[out.length - 1]!)!;
    let best = 0;
    for (let i = 1; i < left.length; i++) if (km(cur, at(left[i]!)!) < km(cur, at(left[best]!)!)) best = i;
    out.push(left.splice(best, 1)[0]!);
  }
  return [...out, ...unlocated];
}

interface OrgData {
  todayDate: string;
  weekStart: string;
  categories: Map<string, Row<"account_category">>;
  areas: Map<string, Row<"postal_area">>;
  campaigns: Array<{ c: Row<"campaign">; territories: Set<string>; categories: Set<string> }>;
  nowMs: number;
}

async function loadOrg(db: Db, me: Principal, nowMs: number): Promise<OrgData> {
  const todayDate = today(me.org, nowMs);
  const weekStart = addDays(startOfWeek(todayDate), 7);
  const friday = addDays(weekStart, 4);
  const categories = new Map((await db.account_category.all()).map((c) => [c.id, c]));
  const areas = new Map((await db.postal_area.all()).map((p) => [p.postal_code, p]));
  const active = (await db.campaign.all({ status: "active" })).filter((c) => c.starts_on <= friday && c.ends_on >= weekStart);
  const ids = active.map((c) => c.id);
  const terr = ids.length ? await db.campaign_territory.all({ campaign_id: ids }) : [];
  const cats = ids.length ? await db.campaign_category.all({ campaign_id: ids }) : [];
  const campaigns = active
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .map((c) => ({ c, territories: new Set(terr.filter((t) => t.campaign_id === c.id).map((t) => t.territory_id)), categories: new Set(cats.filter((t) => t.campaign_id === c.id).map((t) => t.category_id)) }));
  return { todayDate, weekStart, categories, areas, campaigns, nowMs };
}

/** Score one rep's owned accounts (lost ones excluded). Only accounts with a score > 0 or due this week qualify. */
export async function scoreRep(db: Db, me: Principal, o: OrgData, repId: string, skip: Set<string>): Promise<Scored[]> {
  const accounts = (await db.account.all({ owner_rep_id: repId })).filter((a) => a.account_type !== "lost" && !skip.has(a.id));
  if (!accounts.length) return [];
  const accIds = accounts.map((a) => a.id);
  const done = await db.visit.all({ account_id: accIds, status: "done" });
  const lastVisit = new Map<string, string>();
  for (const v of done) {
    const d = v.completed_at ? localDate(me.org, v.completed_at) : v.planned_date;
    if (!lastVisit.has(v.account_id) || d > lastVisit.get(v.account_id)!) lastVisit.set(v.account_id, d);
  }
  const metrics = new Map((await db.account_metrics.all({ account_id: accIds })).map((m) => [m.account_id, m]));
  const weekEnd = addDays(o.weekStart, 6);
  const promises = (await db.task.all({ account_id: accIds, status: "open", is_customer_promise: true }))
    .filter((t) => t.due_at && localDate(me.org, t.due_at) <= weekEnd)
    .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)) || a.id.localeCompare(b.id));
  const added = await db.candidate.all({ converted_account_id: accIds, status: "added" });
  const since = o.nowMs - 14 * 86_400_000;

  const out: Scored[] = [];
  for (const a of accounts) {
    const parts: Array<{ pts: number; why: string }> = [];
    let earliest = 0, latest = 4;
    // visit-overdue: today - last done visit > visit_frequency_days ?? category default
    const freq = a.visit_frequency_days ?? (a.category_id ? o.categories.get(a.category_id)?.default_visit_frequency_days : null) ?? null;
    const last = lastVisit.get(a.id) ?? null;
    let dueThisWeek = false;
    if (freq != null) {
      if (last == null) {
        if (a.account_type === "customer") parts.push({ pts: 50, why: "No visit on record" });
      } else {
        const since = daysBetween(last, o.todayDate), over = since - freq;
        if (over > 0) parts.push({ pts: 50 + Math.min(30, 10 * over), why: `Visit overdue: last visit ${since} days ago` });
        else {
          const dueIdx = daysBetween(o.weekStart, addDays(last, freq));
          if (dueIdx <= 4) { dueThisWeek = true; earliest = Math.max(0, dueIdx); }
        }
      }
    }
    const promise = promises.find((t) => t.account_id === a.id);
    if (promise) {
      const due = localDate(me.org, promise.due_at!);
      latest = Math.max(0, Math.min(4, daysBetween(o.weekStart, due)));
      earliest = Math.min(earliest, latest);
      parts.push({ pts: 40, why: `Promise due ${due < o.weekStart ? "already" : DAY_NAMES[weekday(due) - 1]}: ${promise.title}` });
    }
    const m = metrics.get(a.id);
    if (m?.risk_score) {
      const why = m.days_since_last_order != null ? `Hasn't ordered in ${Math.round(m.days_since_last_order)} days` : m.risk_reasons || `Churn risk ${Math.round(m.risk_score)}/100`;
      parts.push({ pts: round2((30 * m.risk_score) / 100), why });
    }
    const camp = o.campaigns.find(({ territories, categories }) =>
      (!territories.size || (!!a.territory_id && territories.has(a.territory_id))) && (!categories.size || (!!a.category_id && categories.has(a.category_id))));
    if (camp) parts.push({ pts: 15, why: `Campaign: ${camp.c.title}` });
    const recentProspect = a.account_type === "prospect" && (
      added.some((c) => c.converted_account_id === a.id && Math.max(Number((c as any).updated_at ?? 0), Number((c as any).created_at ?? 0)) >= since) ||
      (a.source === "prospecting" && Number((a as any).created_at ?? 0) >= since));
    if (recentProspect) parts.push({ pts: 10, why: "New prospect added to your route" });

    const score = round2(parts.reduce((s, p) => s + p.pts, 0));
    if (score <= 0 && !dueThisWeek) continue;
    const top = parts.reduce<{ pts: number; why: string } | null>((b, p) => (!b || p.pts > b.pts ? p : b), null);
    out.push({ account: a, score, reason: top?.why ?? `Routine visit (every ${freq} days)`, earliest, latest, recentProspect });
  }
  return out.sort((x, y) => y.score - x.score || x.account.name.localeCompare(y.account.name) || x.account.id.localeCompare(y.account.id));
}

/** Fill Mon-Fri in score order under the daily cap (and max 2 recent prospects a day), then route each day. */
export function fillWeek(o: OrgData, scored: Scored[], cap: number, taken: number[]): { stops: PlannedStop[]; unplaced: string[] } {
  const days: Scored[][] = [[], [], [], [], []];
  const unplaced: string[] = [];
  const fits = (i: number, s: Scored) => days[i]!.length + taken[i]! < cap && (!s.recentProspect || days[i]!.filter((x) => x.recentProspect).length < 2);
  for (const s of scored) {
    let i = -1;
    for (let d = s.earliest; d <= s.latest; d++) if (fits(d, s)) { i = d; break; }
    if (i < 0) for (let d = 0; d < 5; d++) if (fits(d, s)) { i = d; break; }
    if (i < 0) unplaced.push(s.account.id);
    else days[i]!.push(s);
  }
  const dates = workWeek(o.weekStart);
  const coords = (s: Scored) => {
    const pa = s.account.postal_code ? o.areas.get(s.account.postal_code) : undefined;
    const lat = s.account.lat ?? pa?.lat, lng = s.account.lng ?? pa?.lng;
    return lat != null && lng != null ? { lat, lng } : null;
  };
  const stops = days.flatMap((list, i) => routeOrder(list, coords).map((s, k) => ({
    account_id: s.account.id, name: s.account.name, date: dates[i]!, route_position: taken[i]! + k + 1, score: s.score, reason: s.reason,
  })));
  return { stops, unplaced };
}

export function makeImpl(deps: Deps = {}): Impl<"visit-plan-suggest", Principal> {
  return async ({ req, db, me }) => {
    const nowMs = (deps.now ?? Date.now)();
    const o = await loadOrg(db, me, nowMs);
    const dryRun = req.dry_run === true;
    const cap = Math.max(1, Math.floor(me.org.visits_per_day));
    const reps = (await db.app_user.all({ role_code: "rep", status: "active" })).sort((a, b) => a.id.localeCompare(b.id));
    const dates = workWeek(o.weekStart);
    const plans: Array<Record<string, unknown>> = [];
    let created = 0;
    for (const rep of reps) {
      const existing = await db.visit_plan.findOne({ rep_id: rep.id, week_start: o.weekStart });
      if (existing) { plans.push({ rep_id: rep.id, skipped: `plan ${existing.id} already exists (${existing.status})` }); continue; }
      // Visits already on next week (manager-assigned, added by hand) keep their slot and their account.
      const booked = (await db.visit.all({ rep_id: rep.id, status: "planned", planned_date: dates })).sort((a, b) => a.id.localeCompare(b.id));
      const taken = dates.map((d) => booked.filter((v) => v.planned_date === d).length);
      const scored = await scoreRep(db, me, o, rep.id, new Set(booked.map((v) => v.account_id)));
      const { stops, unplaced } = fillWeek(o, scored, cap, taken);
      const perDay = Object.fromEntries(dates.map((d, i) => [d, taken[i]! + stops.filter((s) => s.date === d).length]));
      plans.push({ rep_id: rep.id, visits: stops.length, per_day: perDay, unplaced, stops: dryRun ? stops : undefined });
      if (dryRun) continue;
      const plan = await db.visit_plan.insert({ rep_id: rep.id, week_start: o.weekStart, status: "proposed", accepted_at: null } as any);
      for (const v of booked) if (!v.plan_id) await db.visit.update(v.id, { plan_id: plan.id });
      for (const s of stops) {
        await db.visit.insert({ account_id: s.account_id, rep_id: rep.id, plan_id: plan.id, origin: "plan", planned_date: s.date, route_position: s.route_position, status: "planned", purpose: s.reason } as any);
      }
      created++;
      (plans[plans.length - 1] as Record<string, unknown>).plan_id = plan.id;
      const r = await push(deps.live, "plan.proposed", { plan_id: plan.id, week_start: o.weekStart }, repChannel(rep.id), { now: () => nowMs });
      (plans[plans.length - 1] as Record<string, unknown>).pushed = r.pushed ? true : r.reason ?? false;
    }
    return { processed: reps.length, created, details: { week_start: o.weekStart, dry_run: dryRun, day: dayRange(me.org, o.todayDate).fromDate, plans: JSON.parse(JSON.stringify(plans)) } };
  };
}

export const impl = makeImpl();

/** Cron entry (functions/visit-plan-suggest/index.ts): once per organization; context.api feeds the live push. */
export function makeHandle(deps: Omit<Deps, "live"> = {}) {
  return (context: FunctionContext & { api?: PushPlatform["api"] }) => defineCron("visit-plan-suggest", makeImpl({ ...deps, live: { api: context.api ?? null } }))(context);
}
export const handle = makeHandle();
