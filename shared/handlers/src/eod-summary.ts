// fn:eod-summary (contracts/functions/eod-summary.json, REQ-BUD-010): "wrap up". Deterministic facts for the caller's
// day (visits done, offers sent, new customers, what is still open, where tomorrow starts, target progress) and a
// spoken summary of at most 45 s worded by contracts/llm/eod_summary.json. Code checks: numbers only from facts,
// <= 2.3 words/s x 45 s; otherwise a deterministic summary is used.
import { addDays, dayRange, defineFunction, today, type Impl, type Row } from "../../core/src/index";
import { callStructured, unknownNumbers, type ModelFactory } from "../../llm/src/index";
import { kindText, langOf, maxWords, targetProgress, targetText, wordCount, type Lang } from "./briefing-generate";

export const EOD_MAX_SECONDS = 45;
const MAX_PENDING = 10;

const EOD = {
  el: {
    labels: { visits: "επισκέψεις που έγιναν", offers: "προσφορές που στάλθηκαν", customers: "νέοι πελάτες", pending: "εκκρεμότητα", tomorrow: "αύριο ξεκινάς με", target: "στόχος" },
    notVisited: (name: string) => `Δεν έγινε η επίσκεψη: ${name}`,
    task: (title: string, account: string | null) => `Εργασία: ${title}${account ? ` (${account})` : ""}`,
    approval: (kind: string) => `Εκκρεμεί έγκριση: ${kind}`,
    head: (v: number, o: number, n: number) => `Σήμερα: ${v} επισκέψεις, ${o} προσφορές, ${n} νέοι πελάτες.`,
    open: (xs: string[]) => `Εκκρεμούν: ${xs.join("· ")}.`,
    nothingOpen: "Δεν έμεινε κάτι ανοιχτό.",
    tomorrow: (s: string) => `Αύριο ξεκινάς με ${s}.`,
  },
  en: {
    labels: { visits: "visits done", offers: "offers sent", customers: "new customers", pending: "still open", tomorrow: "tomorrow starts with", target: "target" },
    notVisited: (name: string) => `Not visited: ${name}`,
    task: (title: string, account: string | null) => `Task: ${title}${account ? ` (${account})` : ""}`,
    approval: (kind: string) => `Waiting for approval: ${kind}`,
    head: (v: number, o: number, n: number) => `Today: ${v} visits, ${o} offers sent, ${n} new customers.`,
    open: (xs: string[]) => `Still open: ${xs.join("; ")}.`,
    nothingOpen: "Nothing is left open.",
    tomorrow: (s: string) => `Tomorrow you start with ${s}.`,
  },
} as const;

export interface EodFacts { visits_done: number; offers_sent: number; new_customers: number; pending: string[]; tomorrow_start_with: string | null; targets: string[] }
export function fallbackSummary(lang: Lang, f: EodFacts): string {
  const T = EOD[lang];
  let pending = f.pending.slice(0, 3);
  const build = () => [T.head(f.visits_done, f.offers_sent, f.new_customers), pending.length ? T.open(pending) : T.nothingOpen, f.tomorrow_start_with ? T.tomorrow(f.tomorrow_start_with) : "", ...f.targets.map((t) => `${t}.`)].filter(Boolean).join(" ");
  let s = build();
  while (wordCount(s) > maxWords(EOD_MAX_SECONDS) && pending.length) { pending = pending.slice(0, -1); s = build(); }
  return s;
}

const ms = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN);

export function makeImpl(deps: { model?: ModelFactory; now?: () => number } = {}): Impl<"eod-summary"> {
  return async ({ req, db, me }) => {
    const org = me.org;
    const date = req.date ?? today(org, deps.now?.() ?? Date.now());
    const lang = langOf(me.user, org);
    const T = EOD[lang];
    const day = dayRange(org, date);
    const inDay = (v: unknown) => ms(v) >= ms(day.from) && ms(v) < ms(day.to);
    const accounts = new Map<string, Row<"account">>();
    const nameOf = async (id: string | null | undefined) => {
      if (!id) return null;
      if (!accounts.has(id)) { const a = await db.account.get(id); if (a) accounts.set(id, a); }
      return accounts.get(id)?.name ?? null;
    };

    const todays = await db.visit.all({ rep_id: me.id, planned_date: date });
    const doneIds = new Set(todays.filter((v) => v.status === "done").map((v) => v.id));
    for (const v of await db.visit.all({ rep_id: me.id, status: "done", completed_at: { op: "is_not_null" } })) if (inDay(v.completed_at)) doneIds.add(v.id);

    const approvals = await db.approval.all({ requested_by: me.id });
    const offers = approvals.filter((a) => a.kind === "customer_message" && a.status === "sent" && inDay(a.decided_at ?? a.updated_at)).length;
    const newCustomers = (await db.account.all({ owner_rep_id: me.id, customer_since: date })).length;

    const pending: string[] = [];
    const routeThenName = async (vs: Row<"visit">[]) => {
      const named = await Promise.all(vs.map(async (v) => ({ v, name: (await nameOf(v.account_id)) ?? "?" })));
      return named.sort((a, b) => (a.v.route_position ?? 1e9) - (b.v.route_position ?? 1e9) || a.name.localeCompare(b.name));
    };
    for (const { name } of await routeThenName(todays.filter((v) => v.status === "planned"))) pending.push(T.notVisited(name));
    const endTomorrow = ms(dayRange(org, addDays(date, 1)).to);
    const tasks = (await db.task.all({ owner_id: me.id, status: "open" })).filter((t) => t.due_at && ms(t.due_at) < endTomorrow).sort((a, b) => ms(a.due_at) - ms(b.due_at));
    for (const t of tasks) pending.push(T.task(t.title, await nameOf(t.account_id)));
    for (const a of approvals.filter((x) => x.status === "pending")) pending.push(T.approval(kindText(lang, a.kind)));

    const tomorrowVisits = await routeThenName(await db.visit.all({ rep_id: me.id, planned_date: addDays(date, 1), status: "planned" }));
    const first = tomorrowVisits[0];
    const tomorrow = first ? `${first.name}${first.v.purpose ? ` (${first.v.purpose})` : ""}` : null;

    const target_progress = await targetProgress(db, me.id, date);
    const facts: EodFacts = { visits_done: doneIds.size, offers_sent: offers, new_customers: newCustomers, pending: pending.slice(0, MAX_PENDING), tomorrow_start_with: tomorrow, targets: target_progress.map((t) => targetText(lang, org, t)) };

    const factList = [
      { label: T.labels.visits, value: String(facts.visits_done) },
      { label: T.labels.offers, value: String(facts.offers_sent) },
      { label: T.labels.customers, value: String(facts.new_customers) },
      ...facts.pending.map((p) => ({ label: T.labels.pending, value: p })),
      ...(tomorrow ? [{ label: T.labels.tomorrow, value: tomorrow }] : []),
      ...facts.targets.map((t) => ({ label: T.labels.target, value: t })),
    ];
    const { spoken, learned } = await speak(lang, factList, facts, deps.model);
    return { date, visits_done: facts.visits_done, offers_sent: facts.offers_sent, new_customers: facts.new_customers, pending: facts.pending, tomorrow_start_with: tomorrow, learned, target_progress, spoken_summary: spoken };
  };
}

/** One LLM wording (retried once on a failed code check); deterministic fallback otherwise. */
export async function speak(lang: Lang, facts: Array<{ label: string; value: string }>, raw: EodFacts, model?: ModelFactory): Promise<{ spoken: string; learned: string | null; source: "llm" | "fallback"; problems: string[] }> {
  const sources = facts.flatMap((f) => [f.label, f.value]);
  const limit = maxWords(EOD_MAX_SECONDS);
  const problems: string[] = [];
  const base = `Speak ${lang === "el" ? "Greek" : "English"} to the rep, at most ${limit} words. Use no number that is not in the facts; write numbers as digits. "learned" is one short lesson from the facts, or null.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let r: Awaited<ReturnType<typeof callStructured<"eod_summary">>>;
    try {
      r = await callStructured("eod_summary", { language: lang, facts }, { model, instructions: problems.length ? `${base}\nYour previous answer was rejected: ${problems.join("; ")}.` : base });
    } catch (e) { problems.push(`llm crashed: ${String((e as Error)?.message ?? e)}`); break; }
    if (!r.ok) { problems.push(`llm: ${r.error.message}`.slice(0, 300)); break; }
    const spoken = r.value.spoken_summary.trim();
    const learned = r.value.learned?.trim() || null;
    const p: string[] = [];
    if (!spoken) p.push("summary is empty");
    const bad = unknownNumbers(`${spoken} ${learned ?? ""}`, sources);
    if (bad.length) p.push(`numbers not in the facts: ${bad.join(", ")}`);
    if (wordCount(spoken) > limit) p.push(`${wordCount(spoken)} words is over ${limit}`);
    if (!p.length) return { spoken, learned, source: "llm", problems };
    problems.push(...p);
  }
  return { spoken: fallbackSummary(lang, raw), learned: null, source: "fallback", problems };
}

export const impl = makeImpl();
/** Wonderful Function entry (functions/eod-summary/index.ts calls this). */
export const handle = defineFunction("eod-summary", impl);
