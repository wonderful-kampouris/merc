// fn:briefing-generate (contracts/functions/briefing-generate.json, REQ-BRF-001, REQ-BRF-002): every 15 min, for
// each active rep whose org-local time is past organization.briefing_time and who has no briefing today, build the
// deterministic items, word them as a <= 90 s script (contracts/llm/briefing_script.json), store briefing +
// briefing_item, and push briefing.ready to rep:{id}.
// This file also holds the pieces fn:briefing-get and fn:eod-summary reuse (Rule B, REQ-CORE-004): the item
// builder, the target-progress computation (contracts/metrics.md#target-progress) and the script checks.
import { addDays, dayRange, daysBetween, defineCron, localParts, type Db, type Filter, type FunctionContext, type Impl, type Principal, type Row } from "../../core/src/index";
import { callStructured, unknownNumbers, type ModelFactory } from "../../llm/src/index";
import { push, repChannel, type PushPlatform } from "../../live/src/index";
import type { Briefing, BriefingItem, TargetProgress } from "../../core/src/generated/contracts/types";

type Org = Row<"organization">;
type User = Row<"app_user">;
export type Lang = "el" | "en";
export const langOf = (user: { preferred_language?: string | null } | null, org: { default_language: string }): Lang =>
  ((user?.preferred_language || org.default_language) === "en" ? "en" : "el");

/** Spoken-length rule of contracts/llm/briefing_script.json: words <= 2.3 words/s x max_seconds. */
export const WORDS_PER_SECOND = 2.3;
export const BRIEFING_MAX_SECONDS = 90;
/** An account is "at risk" in the briefing from this account_metrics.risk_score on (order_gap alone starts at 20). */
export const AT_RISK_MIN = 20;
const MAX_PER_TYPE = 3;
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
export const maxWords = (seconds: number) => Math.floor(WORDS_PER_SECOND * seconds);
export const estimatedSeconds = (s: string) => Math.ceil(wordCount(s) / WORDS_PER_SECOND);

const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const KIND: Record<Lang, Record<string, string>> = {
  el: { customer_message: "μήνυμα σε πελάτη", discount: "έκπτωση", terms: "όροι συνεργασίας", conversion: "μετατροπή σε πελάτη" },
  en: { customer_message: "customer message", discount: "discount", terms: "terms", conversion: "conversion to customer" },
};
const DECISION: Record<Lang, Record<string, string>> = {
  el: { approved: "εγκρίθηκε", countered: "αντιπρόταση", rejected: "απορρίφθηκε" },
  en: { approved: "approved", countered: "countered", rejected: "rejected" },
};
const METRIC: Record<Lang, Record<string, string>> = {
  el: { revenue: "τζίρου", volume: "όγκου", visits: "επισκέψεων", new_customers: "νέων πελατών" },
  en: { revenue: "revenue", volume: "volume", visits: "visits", new_customers: "new customers" },
};
export const TEXT = {
  el: {
    stop: (n: number, name: string, purpose: string | null) => `Στάση ${n}: ${name}${purpose ? ` (${purpose})` : ""}`,
    promise: (title: string, account: string | null, when: string) => `Υπόσχεση${account ? ` στο ${account}` : ""}: ${title}, ${when}`,
    when: { overdue: "εκπρόθεσμη", today: "σήμερα", tomorrow: "αύριο" },
    atRisk: (name: string, days: number | null) => (days == null ? `Σε κίνδυνο: ${name}` : `Σε κίνδυνο: ${name}, ${days} ημέρες χωρίς παραγγελία`),
    approvalMine: (kind: string) => `Εκκρεμεί έγκριση: ${kind}`,
    approvalToMe: (kind: string) => `Περιμένει την έγκρισή σου: ${kind}`,
    decision: (kind: string, status: string) => `Απόφαση για ${kind}: ${status}`,
    campaign: (title: string, ends: string) => `Καμπάνια της εβδομάδας: ${title}, έως ${dm(ends)}`,
    target: (metric: string, actual: number, target: number, unit: string, pct: number, days: number) =>
      `Στόχος ${metric}: ${actual} από ${target}${unit ? ` ${unit}` : ""} (${pct}%), ${days} ημέρες ακόμη`,
    prospect: (name: string) => `Νέος υποψήφιος πελάτης: ${name}`,
    hello: (first: string) => `Καλημέρα ${first}.`,
    empty: "Δεν υπάρχει κάτι προγραμματισμένο για σήμερα.",
  },
  en: {
    stop: (n: number, name: string, purpose: string | null) => `Stop ${n}: ${name}${purpose ? ` (${purpose})` : ""}`,
    promise: (title: string, account: string | null, when: string) => `Promise${account ? ` to ${account}` : ""}: ${title}, ${when}`,
    when: { overdue: "overdue", today: "today", tomorrow: "tomorrow" },
    atRisk: (name: string, days: number | null) => (days == null ? `At risk: ${name}` : `At risk: ${name}, ${days} days without an order`),
    approvalMine: (kind: string) => `Waiting for approval: ${kind}`,
    approvalToMe: (kind: string) => `Waiting for your approval: ${kind}`,
    decision: (kind: string, status: string) => `Decision on ${kind}: ${status}`,
    campaign: (title: string, ends: string) => `Campaign of the week: ${title}, until ${dm(ends)}`,
    target: (metric: string, actual: number, target: number, unit: string, pct: number, days: number) =>
      `Target ${metric}: ${actual} of ${target}${unit ? ` ${unit}` : ""} (${pct}%), ${days} days left`,
    prospect: (name: string) => `New candidate: ${name}`,
    hello: (first: string) => `Good morning ${first}.`,
    empty: "Nothing is planned for today.",
  },
} as const;

/** One spoken/display line for a target (money shown in major units of the org currency, pct rounded). */
export function targetText(lang: Lang, org: { currency: string }, t: TargetProgress): string {
  const money = t.metric === "revenue";
  const v = (x: number) => (money ? Math.round(x / 100) : Math.round(x));
  return TEXT[lang].target(METRIC[lang][t.metric] ?? t.metric, v(t.actual_value), v(t.target_value), money ? org.currency : "", Math.round(t.pct), t.days_left);
}
export const kindText = (lang: Lang, kind: string) => KIND[lang][kind] ?? kind;

// ---- target progress (contracts/metrics.md#target-progress, scope: the user) --------------------------------
const between = (column: string, from: string, to: string): Filter[] => [
  { column, operator: "gte", value: from },
  { column, operator: "lte", value: to },
];
function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
async function actualValue(db: Db, userId: string, metric: string, from: string, to: string): Promise<number> {
  switch (metric) {
    case "visits":
      return (await db.visit.all({ rep_id: userId, status: "done" }, { and: between("planned_date", from, to) })).length;
    case "new_customers":
      return (await db.account.all({ owner_rep_id: userId }, { and: between("customer_since", from, to) })).length;
    case "revenue":
    case "volume": {
      const orders = await db.sales_order.all({ rep_id: userId, status: "confirmed" }, { and: between("order_date", from, to) });
      let sum = 0;
      for (const ids of chunks(orders.map((o) => o.id), 200)) {
        for (const l of await db.order_line.all({ order_id: ids })) {
          sum += metric === "volume" ? l.quantity : l.quantity * l.unit_price_minor * (1 - (l.discount_pct ?? 0) / 100);
        }
      }
      return Math.round(sum);
    }
  }
  return 0;
}
/** The user's own sales targets whose period contains `date`, with actual, pct (1 decimal) and days left. */
export async function targetProgress(db: Db, userId: string, date: string): Promise<TargetProgress[]> {
  const targets = (await db.sales_target.all({ user_id: userId }))
    .filter((t) => t.period_start <= date && date <= t.period_end)
    .sort((a, b) => a.metric.localeCompare(b.metric) || a.period_start.localeCompare(b.period_start));
  const out: TargetProgress[] = [];
  for (const t of targets) {
    const actual = await actualValue(db, userId, t.metric, t.period_start, t.period_end);
    out.push({
      target_id: t.id, metric: t.metric as TargetProgress["metric"], period_start: t.period_start, period_end: t.period_end,
      target_value: t.target_value, actual_value: actual, pct: t.target_value ? Math.round((1000 * actual) / t.target_value) / 10 : 0,
      days_left: Math.max(0, daysBetween(date, t.period_end)),
    });
  }
  return out;
}

// ---- deterministic items (REQ-BRF-002) ----------------------------------------------------------------------
type Draft = Omit<BriefingItem, "position">;
const ms = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN);
const byRoute = (a: { route_position?: number | null; id: string }, b: { route_position?: number | null; id: string }) =>
  (a.route_position ?? 1e9) - (b.route_position ?? 1e9) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface BuildCtx { db: Db; org: Org; rep: User; date: string; lang: Lang }
/**
 * Items in REQ-BRF-002 order: today's stops with their reason, promises due by tomorrow, at-risk customers,
 * pending approvals, decisions received since yesterday, the campaign of the week, target progress, new candidates.
 * Every number is computed here; the LLM only words them.
 */
export async function buildItems({ db, org, rep, date, lang }: BuildCtx): Promise<BriefingItem[]> {
  const T = TEXT[lang];
  const items: Draft[] = [];
  const accounts = new Map<string, Row<"account">>();
  const remember = (rows: Row<"account">[]) => rows.forEach((a) => accounts.set(a.id, a));
  const nameOf = async (id: string | null | undefined): Promise<string | null> => {
    if (!id) return null;
    if (!accounts.has(id)) { const a = await db.account.get(id); if (a) accounts.set(id, a); }
    return accounts.get(id)?.name ?? null;
  };

  // 1. today's stops
  const visits = (await db.visit.all({ rep_id: rep.id, planned_date: date, status: ["planned", "done"] })).sort(byRoute);
  if (visits.length) remember(await db.account.all({ id: [...new Set(visits.map((v) => v.account_id))] }));
  for (const [i, v] of visits.entries()) {
    items.push({ item_type: "stop", display_text: T.stop(i + 1, (await nameOf(v.account_id)) ?? "?", v.purpose ?? null), ref_table: "visit", ref_id: v.id });
  }

  // 2. customer promises due by the end of tomorrow (overdue included)
  const endTomorrow = ms(dayRange(org, addDays(date, 1)).to);
  const promises = (await db.task.all({ owner_id: rep.id, status: "open", is_customer_promise: true }))
    .filter((t) => t.due_at && ms(t.due_at) < endTomorrow)
    .sort((a, b) => ms(a.due_at) - ms(b.due_at));
  for (const p of promises.slice(0, MAX_PER_TYPE)) {
    const due = localParts(org, p.due_at!).date;
    const when = due < date ? T.when.overdue : due === date ? T.when.today : T.when.tomorrow;
    items.push({ item_type: "promise_due", display_text: T.promise(p.title, await nameOf(p.account_id), when), ref_table: "task", ref_id: p.id });
  }

  // 3. at-risk customers (account_metrics, computed by fn:metrics-rollup per metrics.md#risk)
  const owned = await db.account.all({ owner_rep_id: rep.id, account_type: "customer" });
  remember(owned);
  const latest = new Map<string, Row<"account_metrics">>();
  for (const m of owned.length ? await db.account_metrics.all({ account_id: owned.map((a) => a.id) }) : []) {
    const cur = latest.get(m.account_id);
    if (!cur || ms(m.computed_at) > ms(cur.computed_at)) latest.set(m.account_id, m);
  }
  const risky = [...latest.values()].filter((m) => (m.risk_score ?? 0) >= AT_RISK_MIN).sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0));
  for (const m of risky.slice(0, MAX_PER_TYPE)) {
    const days = m.days_since_last_order == null ? null : Math.round(m.days_since_last_order);
    items.push({ item_type: "at_risk", display_text: T.atRisk((await nameOf(m.account_id)) ?? "?", days), ref_table: "account", ref_id: m.account_id });
  }

  // 4. pending approvals (the rep's own requests, and requests waiting on them)
  const mine = await db.approval.all({ requested_by: rep.id, status: "pending" });
  const toMe = (await db.approval.all({ approver_id: rep.id, status: "pending" })).filter((a) => a.requested_by !== rep.id);
  for (const a of mine.slice(0, MAX_PER_TYPE)) items.push({ item_type: "pending_approval", display_text: T.approvalMine(kindText(lang, a.kind)), ref_table: "approval", ref_id: a.id });
  for (const a of toMe.slice(0, MAX_PER_TYPE)) items.push({ item_type: "pending_approval", display_text: T.approvalToMe(kindText(lang, a.kind)), ref_table: "approval", ref_id: a.id });

  // 5. decisions received since the start of yesterday
  const since = ms(dayRange(org, addDays(date, -1)).from), until = ms(dayRange(org, date).to);
  const decided = (await db.approval.all({ requested_by: rep.id, status: ["approved", "countered", "rejected"] }))
    .filter((a) => a.decided_at && ms(a.decided_at) >= since && ms(a.decided_at) < until)
    .sort((a, b) => ms(b.decided_at) - ms(a.decided_at));
  for (const a of decided.slice(0, MAX_PER_TYPE)) {
    items.push({ item_type: "decision_received", display_text: T.decision(kindText(lang, a.kind), DECISION[lang][a.status] ?? a.status), ref_table: "approval", ref_id: a.id });
  }

  // 6. campaign of the week: active, running today, targeted at the rep, their territory, or untargeted
  const camps = (await db.campaign.all({ status: "active" })).filter((c) => c.starts_on <= date && date <= c.ends_on);
  if (camps.length) {
    const ids = camps.map((c) => c.id);
    const terr = new Set((await db.territory_rep.all({ user_id: rep.id })).map((r) => r.territory_id));
    const ct = await db.campaign_territory.all({ campaign_id: ids });
    const cr = await db.campaign_rep.all({ campaign_id: ids });
    const forRep = camps.filter((c) => {
      const t = ct.filter((x) => x.campaign_id === c.id), r = cr.filter((x) => x.campaign_id === c.id);
      return (!t.length && !r.length) || t.some((x) => terr.has(x.territory_id)) || r.some((x) => x.user_id === rep.id);
    }).sort((a, b) => b.starts_on.localeCompare(a.starts_on) || a.id.localeCompare(b.id));
    for (const c of forRep.slice(0, 2)) items.push({ item_type: "campaign", display_text: T.campaign(c.title, c.ends_on), ref_table: "campaign", ref_id: c.id });
  }

  // 7. target progress
  for (const t of await targetProgress(db, rep.id, date)) items.push({ item_type: "target_progress", display_text: targetText(lang, org, t), ref_table: "sales_target", ref_id: t.target_id });

  // 8. new candidates assigned to the rep
  const cands = (await db.candidate.all({ assigned_rep_id: rep.id, status: ["new", "researched", "scored"] })).sort((a, b) => a.business_name.localeCompare(b.business_name));
  for (const c of cands.slice(0, MAX_PER_TYPE)) items.push({ item_type: "new_prospect", display_text: T.prospect(c.business_name), ref_table: "candidate", ref_id: c.id });

  return items.map((x, i) => ({ position: i + 1, ...x }));
}

// ---- spoken script (contracts/llm/briefing_script.json) -----------------------------------------------------
/** Code checks of the briefing_script rules: numbers are a subset of the items' numbers; length fits max_seconds. */
export function scriptProblems(text: string, sources: string[], maxSeconds: number): string[] {
  const p: string[] = [];
  if (!text.trim()) p.push("script is empty");
  const bad = unknownNumbers(text, sources);
  if (bad.length) p.push(`numbers not in any item: ${bad.join(", ")}`);
  const w = wordCount(text);
  if (w > maxWords(maxSeconds)) p.push(`${w} words is over ${maxWords(maxSeconds)} (${maxSeconds} s at ${WORDS_PER_SECOND} words/s)`);
  return p;
}
/** Deterministic script: greeting + the items in order, trimmed from the end to fit. Always passes scriptProblems. */
export function fallbackScript(lang: Lang, repName: string, items: Pick<BriefingItem, "display_text">[], maxSeconds = BRIEFING_MAX_SECONDS): string {
  const T = TEXT[lang];
  const first = repName.trim().split(/\s+/)[0] || repName;
  const parts = [T.hello(first), ...(items.length ? items.map((i) => `${i.display_text.replace(/[.\s]+$/, "")}.`) : [T.empty])];
  while (parts.length > 1 && wordCount(parts.join(" ")) > maxWords(maxSeconds)) parts.pop();
  return parts.join(" ");
}

export interface ScriptResult { text: string; estimated_seconds: number; source: "llm" | "fallback"; problems: string[] }
export interface GenerateDeps { model?: ModelFactory; now?: () => number }

export async function writeScript(input: { rep_name: string; language: Lang; date: string; items: BriefingItem[] }, deps: GenerateDeps = {}): Promise<ScriptResult> {
  const sources = input.items.map((i) => i.display_text);
  const problems: string[] = [];
  const base = [
    `Speak ${input.language === "el" ? "Greek" : "English"}, warm and brief, as a colleague on the phone.`,
    `At most ${maxWords(BRIEFING_MAX_SECONDS)} words. Greet the rep by first name, read the items in their order, then offer to start with the first stop.`,
    "Use no number that is not written in an item's display_text; write numbers as digits. Do not say the date.",
  ].join("\n");
  for (let attempt = 0; input.items.length && attempt < 2; attempt++) {
    const instructions = problems.length ? `${base}\nYour previous script was rejected: ${problems.join("; ")}. Fix that.` : base;
    let r: Awaited<ReturnType<typeof callStructured<"briefing_script">>>;
    try {
      r = await callStructured("briefing_script", { ...input, max_seconds: BRIEFING_MAX_SECONDS }, { model: deps.model, instructions });
    } catch (e) {
      problems.push(`llm crashed: ${String((e as Error)?.message ?? e)}`);
      break;
    }
    if (!r.ok) { problems.push(`llm: ${r.error.message}`.slice(0, 300)); break; }
    const text = r.value.script_text.trim();
    const p = scriptProblems(text, sources, BRIEFING_MAX_SECONDS);
    if (!p.length) return { text, estimated_seconds: estimatedSeconds(text), source: "llm", problems };
    problems.push(...p);
  }
  const text = fallbackScript(input.language, input.rep_name, input.items);
  return { text, estimated_seconds: estimatedSeconds(text), source: "fallback", problems };
}

// ---- persistence ---------------------------------------------------------------------------------------------
type ItemLike = { position: number; item_type: string; display_text: string; ref_table?: string | null; ref_id?: string | null };
function toBriefing(b: Row<"briefing">, items: ItemLike[]): Briefing {
  return {
    briefing_id: b.id, date: b.briefing_date, status: b.status as Briefing["status"], script_text: b.script_text ?? "",
    items: [...items].sort((x, y) => x.position - y.position).map((i) => ({ position: Math.round(i.position), item_type: i.item_type, display_text: i.display_text, ref_table: i.ref_table ?? null, ref_id: i.ref_id ?? null })),
  };
}
export async function loadBriefing(db: Db, repId: string, date: string): Promise<Briefing | null> {
  const b = await db.briefing.findOne({ rep_id: repId, briefing_date: date });
  if (!b) return null;
  return toBriefing(b, await db.briefing_item.all({ briefing_id: b.id }, { orderBy: [{ column: "position", direction: "asc" }] }));
}

export interface Generated { briefing: Briefing; created: boolean; source: "llm" | "fallback" | "existing"; problems: string[] }
/** Build and store one briefing (one per rep per day: the unique index and a pre-check guard it). */
export async function generateForRep(db: Db, org: Org, rep: User, date: string, deps: GenerateDeps = {}, opts: { regenerate?: boolean } = {}): Promise<Generated> {
  const existing = await db.briefing.findOne({ rep_id: rep.id, briefing_date: date });
  if (existing && !opts.regenerate) return { briefing: (await loadBriefing(db, rep.id, date))!, created: false, source: "existing", problems: [] };
  const lang = langOf(rep, org);
  const items = await buildItems({ db, org, rep, date, lang });
  const script = await writeScript({ rep_name: rep.full_name, language: lang, date, items }, deps);
  let row: Row<"briefing">;
  if (existing) {
    for (const it of await db.briefing_item.all({ briefing_id: existing.id })) await db.briefing_item.delete(it.id);
    row = await db.briefing.update(existing.id, { script_text: script.text, status: "generated", delivered_at: null, delivery_channel: null });
  } else {
    try {
      row = await db.briefing.insert({ rep_id: rep.id, briefing_date: date, script_text: script.text, status: "generated" });
    } catch (e) {
      const won = (e as { code?: string })?.code === "conflict" ? await loadBriefing(db, rep.id, date) : null;
      if (won) return { briefing: won, created: false, source: "existing", problems: [] };
      throw e;
    }
  }
  try {
    for (const it of items) await db.briefing_item.insert({ briefing_id: row.id, position: it.position, item_type: it.item_type as Row<"briefing_item">["item_type"], display_text: it.display_text, ref_table: it.ref_table ?? null, ref_id: it.ref_id ?? null });
  } catch (e) {
    if (!existing) { try { await db.briefing.delete(row.id); } catch { /* leave it; the next run reports it */ } }
    throw e;
  }
  return { briefing: toBriefing(row, items), created: !existing, source: script.source, problems: script.problems };
}

// ---- the cron ------------------------------------------------------------------------------------------------
export type BriefingPush = (repId: string, payload: { briefing_id: string; date: string }) => Promise<{ pushed: boolean; reason?: string }>;
export interface CronDeps extends GenerateDeps { push?: BriefingPush }

export function makeImpl(deps: CronDeps = {}): Impl<"briefing-generate", Principal> {
  return async ({ req, db, me }) => {
    const org = me.org;
    const local = localParts(org, deps.now?.() ?? Date.now());
    const date = local.date;
    if (local.time < org.briefing_time) {
      return { processed: 0, created: 0, details: { date, local_time: local.time, skipped: `before briefing_time ${org.briefing_time}` } };
    }
    const reps = (await db.app_user.all({ role_code: "rep", status: "active" })).sort((a, b) => a.id.localeCompare(b.id));
    let created = 0;
    const out: Record<string, unknown>[] = [];
    for (const rep of reps) {
      try {
        if (await db.briefing.findOne({ rep_id: rep.id, briefing_date: date })) { out.push({ rep_id: rep.id, status: "exists" }); continue; }
        if (req.dry_run) { out.push({ rep_id: rep.id, status: "would_create" }); continue; }
        const g = await generateForRep(db, org, rep, date, deps);
        if (!g.created) { out.push({ rep_id: rep.id, status: "exists" }); continue; }
        created++;
        const p = deps.push ? await deps.push(rep.id, { briefing_id: g.briefing.briefing_id, date }) : { pushed: false, reason: "no_push" };
        out.push({
          rep_id: rep.id, status: "created", briefing_id: g.briefing.briefing_id, items: g.briefing.items.length, script: g.source,
          ...(g.problems.length ? { script_problems: g.problems.slice(0, 5) } : {}), push: p.pushed ? "sent" : (p.reason ?? "failed"),
        });
      } catch (e) {
        out.push({ rep_id: rep.id, status: "failed", error: String((e as Error)?.message ?? e).slice(0, 300) });
      }
    }
    return { processed: reps.length, created, details: { date, dry_run: !!req.dry_run, reps: out } };
  };
}

/** Wonderful cron entry (functions/briefing-generate/index.ts): one run per org, pushes through context.api. */
export function handle(context: FunctionContext) {
  const live = context as unknown as PushPlatform;
  const pushBriefing: BriefingPush = (repId, payload) => push(live, "briefing.ready", payload, repChannel(repId));
  return defineCron("briefing-generate", makeImpl({ push: pushBriefing }))(context);
}
