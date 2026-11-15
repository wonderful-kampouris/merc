// fn:debrief-process (contracts/functions/debrief-process.json): REQ-DEB-002..008, REQ-CORE-003, REQ-NFR-001.
// One rep debrief -> structured extraction (contracts/llm/debrief_extraction.json) -> code re-validation
// (evidence, numbers, ids, dates, channel) -> internal actions applied as ai_action rows with snapshots,
// the follow-up message drafted as a customer_message approval (never sent here) -> ResultCard.
//
// Every action goes through shared/autonomy propose(): mode from ai_permission (role) else
// action_type.default_mode, destructive never; auto -> write + ai_action(applied, before/after snapshots that
// fn:ai-action-undo restores), ask/never -> ai_action(suggested) without a write.
import {
  addDays, blocked, invalid, listAccounts, localParts, nextWeekday, notFound, principalFromFunction, requireAccount,
  runFunction, today, zonedInstant, assertOwner, type Db, type FunctionContext, type Impl, type Row, type UserPrincipal,
} from "../../core/src/index";
import { callStructured, enforceDebriefEvidence, extractNumbers, normalizeText, evidenceInUtterance, unknownNumbers, type CallResult, type DebriefOutput, type Dropped, type LlmInputMap, type LlmOutputMap } from "../../llm/src/index";
import { propose, undo, type ActionClass, type Target, type Writer } from "../../autonomy/src/index";
import { pushToRepAndTeams, type ApiLike } from "../../live/src/index";
import { draftMessage } from "./draft-message";
import type { ModelFactory } from "../../llm/src/index";
import type { FunctionResponseMap } from "../../core/src/index";

type Res = FunctionResponseMap["debrief-process"];
type Card = NonNullable<Res["result"]>;
type Line = Card["lines"][number];
type Missing = Card["missing_fields"][number];
type ApprovalCard = Card["pending_approvals"][number];
type AccountRef = Res["candidates"][number];
type Lang = "el" | "en";

// ---------------------------------------------------------------------------------------------------------
// Dependencies (injected so tests use a fake model; the deployed entry uses the runtime model profiles).
export type Extract = (input: LlmInputMap["debrief_extraction"], instructions: string) => Promise<CallResult<LlmOutputMap["debrief_extraction"]>>;
/** draftModel: the chat model factory fn:draft-message uses (tests inject a fake; default = runtime model profiles). */
export interface DebriefDeps { extract: Extract; draftModel?: ModelFactory; now?: () => number; log?: (msg: string) => void }

export const runtimeDeps: DebriefDeps = {
  extract: (input, instructions) => callStructured("debrief_extraction", input, { instructions }),
};

export const EXTRACT_RULES = [
  "Extra rules (Merc code re-checks all of them):",
  "- Evidence: copy one short contiguous quote (3-20 words) from the utterance, exactly as written. For dated items include the date words (e.g. 'την Πέμπτη', 'tomorrow') in the quote.",
  "- Money is *_minor (cents of the org currency): '1.500 ευρώ' -> 150000. Only amounts the rep said; otherwise null.",
  "- price_delta_pct is negative when the competitor is cheaper ('15% less' -> -15).",
  "- tasks: promises the rep made to the customer get is_customer_promise=true. due_at: 09:00 local time on the resolved date, ISO with offset, or null if no date was said.",
  "- problems: reuse existing_problem_id when the rep talks about an open problem from the input list.",
  "- deal_update: when nothing about a deal was said, every field null and evidence \"\". stage_code only from: new, qualified, proposal, negotiation, won, lost.",
  "- order_intent: when no order was said, lines [] and evidence \"\".",
  "- follow_up: only when the rep asks to send/write a message to the customer; otherwise intent \"\", channel \"email\", evidence \"\". channel only if the rep named it.",
  "- campaigns_pitched: only campaigns from active_campaigns that the rep says they showed or pitched.",
  "- contacts: only people at the customer that the rep names; phone/email only if said.",
  "- note: 1-2 sentences in the utterance's language summarizing the visit. No numbers, names or facts that are not in the utterance.",
  "- Unknown or unclear values: leave them null and add a missing_fields question in the utterance's language.",
].join("\n");

// ---------------------------------------------------------------------------------------------------------
// Grounding helpers (pure; exported for tests).
const WEEKDAYS: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
  δευτερα: 1, τριτη: 2, τεταρτη: 3, πεμπτη: 4, παρασκευη: 5, σαββατο: 6, κυριακη: 7,
  δευτερασ: 1, τριτησ: 2, τεταρτησ: 3, πεμπτησ: 4, παρασκευησ: 5, σαββατου: 6, κυριακησ: 7,
};
const REL: Record<string, number> = { today: 0, tomorrow: 1, σημερα: 0, αυριο: 1, μεθαυριο: 2 };

/**
 * The local date a quote refers to, computed by code (REQ-DEB-006, REQ-CORE-007): a weekday word -> the next such
 * day after today; today/tomorrow words; else the model's date only when its day-of-month is said in the quote.
 * Returns null when the quote holds no date.
 */
export function groundedDate(evidence: string, todayDate: string, modelDate: string | null | undefined): string | null {
  const words = normalizeText(evidence).split(" ");
  for (const w of words) if (w in REL) return addDays(todayDate, REL[w]!);
  for (const w of words) if (w in WEEKDAYS) return nextWeekday(todayDate, WEEKDAYS[w]!);
  if (modelDate && /^\d{4}-\d{2}-\d{2}/.test(modelDate)) {
    const day = Number(modelDate.slice(8, 10));
    if (extractNumbers(evidence).includes(day)) return modelDate.slice(0, 10);
  }
  return null;
}

const CHANNEL_WORDS: Record<"email" | "whatsapp" | "viber", string[]> = {
  email: ["email", "e mail", "mail", "μειλ", "μεηλ", "ιμειλ", "ημειλ", "μαιλ", "ηλεκτρονικο μηνυμα"],
  whatsapp: ["whatsapp", "whats app", "γουατσαπ", "βατσαπ", "watsapp"],
  viber: ["viber", "βαιμπερ", "βαηπερ"],
};
/** The follow-up channel the rep actually named in the utterance (model value first), or null. */
export function groundedChannel(utterance: string, modelChannel: string | null | undefined): "email" | "whatsapp" | "viber" | null {
  const u = ` ${normalizeText(utterance)} `;
  const said = (c: keyof typeof CHANNEL_WORDS) => CHANNEL_WORDS[c].some((w) => u.includes(` ${w} `) || u.includes(` ${w}`) && w.length > 4);
  if (modelChannel && modelChannel in CHANNEL_WORDS && said(modelChannel as keyof typeof CHANNEL_WORDS)) return modelChannel as keyof typeof CHANNEL_WORDS;
  for (const c of Object.keys(CHANNEL_WORDS) as Array<keyof typeof CHANNEL_WORDS>) if (said(c)) return c;
  return null;
}

const GR2LAT: Record<string, string> = { α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o" };
/** Normalized + Greek transliterated to Latin, so "Αρόμα" and "Aroma" compare equal. */
export function latinKey(s: string): string {
  let out = "";
  for (const ch of normalizeText(s)) out += GR2LAT[ch] ?? ch;
  return out.replace(/y/g, "i").replace(/ou/g, "u").replace(/h/g, "");
}
/** Known competitor whose name (or first word) matches `name`, or null. */
export function matchCompetitor<T extends { name: string }>(name: string, known: T[]): T | null {
  const k = latinKey(name);
  if (!k) return null;
  return known.find((c) => latinKey(c.name) === k)
    ?? known.find((c) => latinKey(c.name).startsWith(`${k} `) || k.startsWith(`${latinKey(c.name)} `))
    ?? null;
}
/** Does the (normalized, transliterated) utterance mention this name? */
export const mentions = (utterance: string, name: string): boolean => {
  const u = ` ${latinKey(utterance)} `, n = latinKey(name);
  return !!n && (u.includes(` ${n} `) || u.includes(` ${n.split(" ")[0]} `) && n.split(" ")[0]!.length >= 4);
};

/** Accounts whose name the utterance mentions (whole words, accent/case/script-insensitive). */
export function accountsMentioned<T extends { name: string }>(utterance: string, accounts: T[]): T[] {
  const u = ` ${latinKey(utterance)} `;
  // 1. the full name, as said
  const full = accounts.filter((a) => { const n = latinKey(a.name); return !!n && u.includes(` ${n} `); });
  if (full.length) return full;
  // 2. every distinctive word (>= 4 letters, not a generic shop word) of the name; words of 6+ letters may
  //    also appear inflected (Greek "Μίλτο" for "Miltos"), so their stem without the last letter counts
  return accounts.filter((a) => {
    const words = latinKey(a.name).split(" ").filter((w) => w.length >= 4 && !GENERIC.has(w));
    return words.length > 0 && words.every((w) => u.includes(` ${w} `) || (w.length >= 6 && u.includes(` ${w.slice(0, -1)}`)));
  });
}
const GENERIC = new Set(["cafe", "kafe", "market", "mini", "fournos", "bistro", "artos", "kafeneio", "bakery", "super"]);

export function langOf(out: { language?: string } | null, hint?: string | null): Lang {
  if (hint === "en" || hint === "el") return hint;
  return out?.language === "en" ? "en" : "el";
}

/** Rule A for the note (acceptance: note text grounded): numbers in the note must be in the utterance. */
export function groundedNote(note: string, utterance: string): { note: string; ok: boolean } {
  const n = (note ?? "").trim();
  if (!n) return { note: utterance.trim().slice(0, 500), ok: false };
  if (unknownNumbers(n, [utterance]).length) return { note: utterance.trim().slice(0, 500), ok: false };
  return { note: n, ok: true };
}

// ---------------------------------------------------------------------------------------------------------
// Texts (spoken summary and line summaries are built by code, so every number in them comes from data).
const T = {
  note: { en: "Visit note saved", el: "Καταχώρησα τη σημείωση της επίσκεψης" },
  task: { en: (t: string, d: string | null) => `Task: ${t}${d ? ` (due ${d})` : ""}`, el: (t: string, d: string | null) => `Εργασία: ${t}${d ? ` (έως ${d})` : ""}` },
  problemNew: { en: (d: string) => `New problem: ${d}`, el: (d: string) => `Νέο πρόβλημα: ${d}` },
  problemUpd: { en: (d: string, s: string) => `Problem "${d}" is now ${s}`, el: (d: string, s: string) => `Το πρόβλημα «${d}» είναι τώρα ${s}` },
  dealUpd: { en: (t: string) => `Deal "${t}" updated`, el: (t: string) => `Ενημέρωσα τη συμφωνία «${t}»` },
  dealNew: { en: (t: string) => `New deal: ${t}`, el: (t: string) => `Νέα συμφωνία: ${t}` },
  signal: { en: (c: string) => `Competitor signal: ${c}`, el: (c: string) => `Ανταγωνισμός: ${c}` },
  contactNew: { en: (n: string) => `New contact: ${n}`, el: (n: string) => `Νέα επαφή: ${n}` },
  contactUpd: { en: (n: string) => `Contact ${n} updated`, el: (n: string) => `Ενημέρωσα την επαφή ${n}` },
  pitch: { en: (c: string) => `Campaign pitched: ${c}`, el: (c: string) => `Παρουσίαση καμπάνιας: ${c}` },
  visit: { en: "Visit marked done", el: "Η επίσκεψη σημειώθηκε ως ολοκληρωμένη" },
  order: { en: (n: number) => `Draft order with ${n} line(s)`, el: (n: number) => `Πρόχειρη παραγγελία με ${n} γραμμή(ές)` },
  draft: { en: (c: string, to: string) => `Follow-up ${c} to ${to} drafted, waiting for your approval`, el: (c: string, to: string) => `Ετοίμασα ${c} προς ${to}, περιμένει την έγκρισή σου` },
  suggested: { en: (s: string) => `Suggested (not applied): ${s}`, el: (s: string) => `Πρόταση (δεν εφαρμόστηκε): ${s}` },
  qChannel: { en: "Should I send the follow-up by email, WhatsApp or Viber?", el: "Να στείλω το μήνυμα με email, WhatsApp ή Viber;" },
  qRecipient: { en: (c: string) => `I have no ${c} address for this customer. Who should get the message?`, el: (c: string) => `Δεν έχω διεύθυνση ${c} για τον πελάτη. Σε ποιον να το στείλω;` },
  qDue: { en: (t: string) => `When is "${t}" due?`, el: (t: string) => `Πότε πρέπει να γίνει «${t}»;` },
  qCompetitor: { en: (c: string) => `Which competitor is "${c}"? I don't know it.`, el: (c: string) => `Ποιος ανταγωνιστής είναι το «${c}»; Δεν τον γνωρίζω.` },
  qProduct: { en: (p: string) => `Which product is "${p}"?`, el: (p: string) => `Ποιο προϊόν είναι το «${p}»;` },
  qQty: { en: (p: string) => `How much ${p}?`, el: (p: string) => `Πόση ποσότητα ${p};` },
  qStage: { en: "Which deal stage is it at now?", el: "Σε ποιο στάδιο είναι τώρα η συμφωνία;" },
  qDraft: { en: (e: string) => `I could not draft the follow-up (${e}). Should I try again?`, el: (e: string) => `Δεν μπόρεσα να ετοιμάσω το μήνυμα (${e}). Να ξαναδοκιμάσω;` },
  qAccount: { en: "Which customer was this visit for?", el: "Για ποιον πελάτη ήταν αυτή η επίσκεψη;" },
  sumDone: { en: (n: number) => `Done: ${n} update${n === 1 ? "" : "s"} saved.`, el: (n: number) => `Έγινε: αποθήκευσα ${n} ${n === 1 ? "ενημέρωση" : "ενημερώσεις"}.` },
  sumApprovals: { en: (n: number) => `${n} message${n === 1 ? "" : "s"} waiting for your approval.`, el: (n: number) => `${n} ${n === 1 ? "μήνυμα περιμένει" : "μηνύματα περιμένουν"} την έγκρισή σου.` },
  sumQuestions: { en: (q: string) => `One question: ${q}`, el: (q: string) => `Μια ερώτηση: ${q}` },
  statusWord: { en: (s: string) => s.replace("_", " "), el: (s: string) => ({ open: "ανοιχτό", in_progress: "σε εξέλιξη", resolved: "λυμένο" }[s] ?? s) },
};
const fmtDate = (d: string | null, lang: Lang): string | null => {
  if (!d) return null;
  const [y, m, day] = d.slice(0, 10).split("-");
  return lang === "el" ? `${Number(day)}/${Number(m)}` : `${y}-${m}-${day}`;
};

/** The spoken summary (REQ-DEB-003), built by code from the card (no model, so no invented numbers). */
export function spokenSummary(lines: Line[], approvals: ApprovalCard[], missing: Missing[], lang: Lang): string {
  const applied = lines.filter((l) => l.status === "applied");
  const parts = [T.sumDone[lang](applied.length), ...applied.map((l) => `${l.summary}.`)];
  if (approvals.length) parts.push(T.sumApprovals[lang](approvals.length));
  if (missing.length) parts.push(T.sumQuestions[lang](missing[0]!.question));
  return parts.join(" ");
}

// ---------------------------------------------------------------------------------------------------------
// Autonomy: every AI write goes through shared/autonomy propose() (REQ-CORE-005/006).
interface Ctx { db: Db; me: UserPrincipal; voiceLogId: string; lang: Lang; nowIso: string; lines: Line[] }

/**
 * Run one AI action through its mode (propose). auto: `apply` writes through the Writer and an applied ai_action
 * with before/after snapshots is stored (fn:ai-action-undo restores it). ask/never: nothing is written except a
 * suggested ai_action (ask also opens the approval). Pushes the card line.
 */
async function act(c: Ctx, code: string, summary: string, payload: unknown, apply: (w: Writer) => Promise<Target>): Promise<{ aiId: string; applied: boolean; target: Target }> {
  const o = await propose(c.db, c.me, { code, agent: "debrief", summary, payload, voice_log_id: c.voiceLogId, apply }, { now: Date.parse(c.nowIso) });
  c.lines.push({ ...o.line, summary: o.applied ? summary : T.suggested[c.lang](summary) });
  return { aiId: o.ai_action.id, applied: o.applied, target: o.target };
}

// ---------------------------------------------------------------------------------------------------------
// Context for the extraction (account scope already checked).
export async function extractionInput(db: Db, me: UserPrincipal, account: Row<"account">, utterance: string, language: string | null, day: string) {
  const [problems, deals, products, campaigns, contacts, competitors] = await Promise.all([
    db.problem.all({ account_id: account.id, status: ["open", "in_progress"] }),
    db.deal.all({ account_id: account.id }),
    db.product.all({ active: true }),
    db.campaign.all({ status: "active" }),
    db.contact.all({ account_id: account.id }),
    db.competitor.all(),
  ]);
  const stages = await db.deal_stage.all();
  const closed = new Set(stages.filter((s) => s.is_closed).map((s) => s.code));
  const live = campaigns.filter((c) => (!c.starts_on || c.starts_on <= day) && (!c.ends_on || c.ends_on >= day));
  const [cps, cts] = live.length ? await Promise.all([db.campaign_product.all({ campaign_id: live.map((c) => c.id) }), db.campaign_territory.all({ campaign_id: live.map((c) => c.id) })]) : [[], []];
  const prodName = new Map(products.map((p) => [p.id, p.name]));
  const forAccount = live.filter((c) => { const t = cts.filter((x) => x.campaign_id === c.id); return !t.length || (!!account.territory_id && t.some((x) => x.territory_id === account.territory_id)); });
  const input: LlmInputMap["debrief_extraction"] = {
    utterance, language_hint: language ?? null, today: day,
    account: accountRef(account),
    open_problems: problems.map((p) => ({ problem_id: p.id, description: p.description })),
    open_deals: deals.filter((d) => !closed.has(d.stage_code)).map((d) => ({ deal_id: d.id, title: d.title, stage_code: d.stage_code, amount_minor: d.amount_minor ?? null })),
    products: products.map((p) => ({ product_id: p.id, name: p.name, unit: p.unit, aliases: [p.sku] })),
    active_campaigns: forAccount.map((c) => ({ campaign_id: c.id, title: c.title, product_names: cps.filter((x) => x.campaign_id === c.id).map((x) => prodName.get(x.product_id) ?? "").filter(Boolean) })),
    contacts: contacts.map((c) => ({ contact_id: c.id, full_name: c.full_name })),
    competitors: competitors.map((c) => c.name),
  };
  return { input, problems, deals, products, campaigns: forAccount, contacts, competitors, stages };
}
type ExtractionContext = Awaited<ReturnType<typeof extractionInput>>;

export function accountRef(a: Row<"account">, extra: Partial<AccountRef> = {}): AccountRef {
  return { id: a.id, name: a.name, account_type: a.account_type as AccountRef["account_type"], postal_code: a.postal_code ?? null, city: null, ...extra };
}

/**
 * Code-side grounding on top of enforceDebriefEvidence (REQ-DEB-004, REQ-CORE-003 and the WP acceptance on
 * non-numeric fields): ids only from the input lists, stage codes only from deal_stage, dates recomputed from the
 * quote, follow-up channel only if named, note numbers only from the utterance. Unsupported values are dropped
 * (or nulled) and asked about.
 */
export function groundOutput(raw: DebriefOutput, x: ExtractionContext, utterance: string, day: string): { out: DebriefOutput; dropped: Dropped[] } {
  const { output, dropped } = enforceDebriefEvidence(raw, utterance);
  const out = output;
  const lang = langOf(out);
  const ask = (field: string, question: string) => { if (!out.missing_fields.some((m) => m.field === field)) out.missing_fields.push({ field, question }); };
  const drop = (path: string, evidence: string) => dropped.push({ path, reason: "evidence_not_in_utterance", evidence });
  const ids = (xs: Array<{ id: string }>) => new Set(xs.map((r) => r.id));
  const problemIds = ids(x.problems), dealIds = new Set(x.input.open_deals.map((d) => d.deal_id)), productIds = ids(x.products), campaignIds = ids(x.campaigns), contactIds = ids(x.contacts);
  const stageCodes = new Set(x.stages.map((s) => s.code));

  const n = groundedNote(out.note, utterance);
  if (!n.ok) drop("/note", out.note);
  out.note = n.note;

  out.problems = out.problems.map((p, i) => {
    const q = { ...p };
    if (q.existing_problem_id && !problemIds.has(q.existing_problem_id)) { drop(`/problems/${i}/existing_problem_id`, q.evidence); q.existing_problem_id = null; }
    const d = q.due_date ? groundedDate(q.evidence, day, q.due_date) : null;
    if (q.due_date && !d) { drop(`/problems/${i}/due_date`, q.evidence); ask(`/problems/${i}/due_date`, T.qDue[lang](q.description)); }
    q.due_date = d;
    return q;
  });
  out.tasks = out.tasks.map((t, i) => {
    const q = { ...t };
    const d = groundedDate(q.evidence, day, q.due_at ?? null);
    if (q.due_at && !d) { drop(`/tasks/${i}/due_at`, q.evidence); ask(`/tasks/${i}/due_at`, T.qDue[lang](q.title)); }
    q.due_at = d; // a local date here; turned into an instant at 09:00 org time when written
    return q;
  });
  const du = { ...out.deal_update };
  if (du.deal_id && !dealIds.has(du.deal_id)) { drop("/deal_update/deal_id", du.evidence); du.deal_id = null; }
  if (du.stage_code && !stageCodes.has(du.stage_code)) { drop("/deal_update/stage_code", du.evidence); du.stage_code = null; ask("/deal_update/stage_code", T.qStage[lang]); }
  if (du.expected_close_date) {
    const d = groundedDate(du.evidence, day, du.expected_close_date);
    if (!d) drop("/deal_update/expected_close_date", du.evidence);
    du.expected_close_date = d;
  }
  if (!du.deal_id && !du.new_deal_title && x.input.open_deals.length === 1 && (du.stage_code || du.amount_minor || du.next_step || du.expected_close_date)) du.deal_id = x.input.open_deals[0]!.deal_id;
  out.deal_update = du;
  out.order_intent = {
    ...out.order_intent,
    lines: out.order_intent.lines.map((l, i) => {
      const q = { ...l };
      if (q.product_id && !productIds.has(q.product_id)) { drop(`/order_intent/lines/${i}/product_id`, out.order_intent.evidence); q.product_id = null; }
      if (!q.product_id) ask(`/order_intent/lines/${i}/product_id`, T.qProduct[lang](q.product_text));
      if (q.quantity === null || q.quantity === undefined) ask(`/order_intent/lines/${i}/quantity`, T.qQty[lang](q.product_text));
      return q;
    }),
  };
  out.competitor_signals = out.competitor_signals.filter((s, i) => {
    if (!mentions(utterance, s.competitor_name)) { drop(`/competitor_signals/${i}/competitor_name`, s.evidence); ask(`/competitor_signals/${i}`, T.qCompetitor[lang](s.competitor_name)); return false; }
    if (!matchCompetitor(s.competitor_name, x.competitors)) { ask(`/competitor_signals/${i}`, T.qCompetitor[lang](s.competitor_name)); return false; }
    return true;
  });
  out.campaigns_pitched = out.campaigns_pitched.filter((c, i) => { const ok = campaignIds.has(c.campaign_id); if (!ok) drop(`/campaigns_pitched/${i}/campaign_id`, c.evidence); return ok; });
  out.contacts = out.contacts.map((c, i) => {
    const q = { ...c };
    if (q.existing_contact_id && !contactIds.has(q.existing_contact_id)) { drop(`/contacts/${i}/existing_contact_id`, q.evidence); q.existing_contact_id = null; }
    if (!q.existing_contact_id) { const known = x.contacts.find((k) => latinKey(k.full_name) === latinKey(q.full_name) || latinKey(k.full_name).split(" ")[0] === latinKey(q.full_name)); if (known) q.existing_contact_id = known.id; }
    for (const k of ["phone", "email", "role_title"] as const) if (q[k] && !evidenceInUtterance(q[k]!, utterance)) { drop(`/contacts/${i}/${k}`, q[k]!); q[k] = null; }
    return q;
  }).filter((c) => mentions(utterance, c.full_name) || !!c.existing_contact_id);
  if (out.follow_up.intent) {
    const ch = groundedChannel(utterance, out.follow_up.channel);
    if (!ch) { drop("/follow_up/channel", out.follow_up.evidence); ask("/follow_up/channel", T.qChannel[lang]); out.follow_up = { ...out.follow_up, channel: "email", intent: "" }; }
    else out.follow_up = { ...out.follow_up, channel: ch };
  }
  return { out, dropped };
}

// ---------------------------------------------------------------------------------------------------------
// Applying the grounded output.
async function applyOutput(c: Ctx, x: ExtractionContext, out: DebriefOutput, account: Row<"account">, visitId: string | null, day: string, deps: DebriefDeps, api: ApiLike | null): Promise<{ approvals: ApprovalCard[]; visitId: string | null }> {
  const { db, me, lang, nowIso } = c;
  const nine = (d: string) => zonedInstant(me.org, d, "09:00");

  // note (always first): the activity of this debrief
  await act(c, "create_note", T.note[lang], { note: out.note }, async (w) => {
    const a = await w.insert("activity", { account_id: account.id, actor_user_id: me.id, visit_id: visitId, voice_log_id: c.voiceLogId, activity_type: out.visit_done ? "visit" : "note", source: "ai", body: out.note, occurred_at: nowIso });
    return { table: "activity", id: a.id };
  });

  if (out.visit_done) {
    const planned = visitId ? await db.visit.get(visitId) : (await db.visit.all({ account_id: account.id, rep_id: me.id, planned_date: day, status: "planned" }))[0] ?? null;
    if (!planned || planned.status !== "done") {
      const r = await act(c, "mark_visit_done", T.visit[lang], { visit_id: planned?.id ?? null }, async (w) => {
        if (planned) { await w.update("visit", planned.id, { status: "done", completed_at: nowIso, outcome: out.note.slice(0, 500) }); return { table: "visit", id: planned.id }; }
        const v = await w.insert("visit", { account_id: account.id, rep_id: me.id, origin: "buddy", planned_date: day, status: "done", started_at: nowIso, completed_at: nowIso, outcome: out.note.slice(0, 500) });
        return { table: "visit", id: v.id };
      });
      if (r.target) visitId = r.target.id;
    } else visitId = planned.id;
  }

  for (const p of out.problems) {
    if (p.existing_problem_id) {
      const cur = x.problems.find((q) => q.id === p.existing_problem_id)!;
      const patch: Record<string, unknown> = { status: p.status, voice_log_id: c.voiceLogId };
      if (p.due_date) patch.due_date = p.due_date;
      if (p.status === "resolved") patch.resolved_at = nowIso;
      await act(c, "update_problem", T.problemUpd[lang](cur.description, T.statusWord[lang](p.status)), { ...p, patch }, async (w) => { await w.update("problem", cur.id, patch); return { table: "problem", id: cur.id }; });
    } else {
      await act(c, "create_problem", T.problemNew[lang](p.description), p, async (w) => {
        const r = await w.insert("problem", { account_id: account.id, description: p.description, status: p.status, due_date: p.due_date ?? null, resolved_at: p.status === "resolved" ? nowIso : null, voice_log_id: c.voiceLogId });
        return { table: "problem", id: r.id };
      });
    }
  }

  const du = out.deal_update;
  let dealId: string | null = du.deal_id ?? null;
  if (du.deal_id) {
    const cur = x.deals.find((d) => d.id === du.deal_id)!;
    const patch: Record<string, unknown> = { last_activity_at: nowIso };
    if (du.stage_code && du.stage_code !== cur.stage_code) patch.stage_code = du.stage_code;
    if (du.amount_minor !== null && du.amount_minor !== undefined) patch.amount_minor = du.amount_minor;
    if (du.next_step) patch.next_step = du.next_step;
    if (du.expected_close_date) patch.expected_close_date = du.expected_close_date;
    if (x.stages.find((s) => s.code === patch.stage_code)?.is_closed) patch.closed_at = nowIso;
    if (Object.keys(patch).length > 1) {
      await act(c, "update_deal", T.dealUpd[lang](cur.title), { ...du, patch }, async (w) => {
        await w.update("deal", cur.id, patch);
        if (patch.stage_code) await w.insert("deal_stage_history", { deal_id: cur.id, from_stage_code: cur.stage_code, to_stage_code: patch.stage_code, changed_by: me.id, changed_at: nowIso });
        return { table: "deal", id: cur.id };
      });
    }
  } else if (du.new_deal_title) {
    const r = await act(c, "create_deal", T.dealNew[lang](du.new_deal_title), du, async (w) => {
      const d = await w.insert("deal", { account_id: account.id, owner_id: me.id, stage_code: du.stage_code ?? "new", title: du.new_deal_title, amount_minor: du.amount_minor ?? null, expected_close_date: du.expected_close_date ?? null, next_step: du.next_step ?? null, last_activity_at: nowIso });
      await w.insert("deal_stage_history", { deal_id: d.id, from_stage_code: null, to_stage_code: d.stage_code, changed_by: me.id, changed_at: nowIso });
      return { table: "deal", id: d.id };
    });
    dealId = r.target?.id ?? null;
  }

  for (const t of out.tasks) {
    const due = t.due_at ? nine(t.due_at) : null;
    await act(c, "create_task", T.task[lang](t.title, fmtDate(t.due_at ?? null, lang)), { ...t, due_at: due }, async (w) => {
      const r = await w.insert("task", { account_id: account.id, owner_id: me.id, deal_id: dealId, title: t.title, is_customer_promise: t.is_customer_promise, due_at: due, status: "open", source: "ai", voice_log_id: c.voiceLogId });
      return { table: "task", id: r.id };
    });
  }

  for (const s of out.competitor_signals) {
    const comp = matchCompetitor(s.competitor_name, x.competitors)!;
    await act(c, "create_competitor_signal", T.signal[lang](`${comp.name}: ${s.statement}`), { ...s, competitor_id: comp.id }, async (w) => {
      const r = await w.insert("competitor_signal", { account_id: account.id, competitor_id: comp.id, reported_by: me.id, statement: s.statement, price_delta_pct: s.price_delta_pct ?? null, observed_at: nowIso, voice_log_id: c.voiceLogId });
      return { table: "competitor_signal", id: r.id };
    });
  }

  const contactIdByName = new Map<string, string>();
  for (const k of out.contacts) {
    if (k.existing_contact_id) {
      const cur = x.contacts.find((q) => q.id === k.existing_contact_id)!;
      contactIdByName.set(latinKey(k.full_name), cur.id);
      const patch: Record<string, unknown> = {};
      for (const f of ["role_title", "phone", "email"] as const) if (k[f] && k[f] !== cur[f]) patch[f] = k[f];
      if (typeof k.is_decision_maker === "boolean" && k.is_decision_maker !== cur.is_decision_maker) patch.is_decision_maker = k.is_decision_maker;
      if (Object.keys(patch).length) await act(c, "update_contact", T.contactUpd[lang](cur.full_name), { ...k, patch }, async (w) => { await w.update("contact", cur.id, patch); return { table: "contact", id: cur.id }; });
    } else {
      const r = await act(c, "create_contact", T.contactNew[lang](k.full_name), k, async (w) => {
        const row = await w.insert("contact", { account_id: account.id, full_name: k.full_name, role_title: k.role_title ?? null, phone: k.phone ?? null, email: k.email ?? null, is_decision_maker: k.is_decision_maker ?? false });
        return { table: "contact", id: row.id };
      });
      if (r.target) contactIdByName.set(latinKey(k.full_name), r.target.id);
    }
  }

  for (const p of out.campaigns_pitched) {
    const camp = x.campaigns.find((q) => q.id === p.campaign_id)!;
    await act(c, "log_campaign_pitch", T.pitch[lang](camp.title), p, async (w) => {
      const r = await w.insert("campaign_exposure", { campaign_id: camp.id, account_id: account.id, rep_id: me.id, stage: "pitched", voice_log_id: c.voiceLogId, evidence_quote: p.evidence.slice(0, 500), occurred_at: nowIso });
      return { table: "campaign_exposure", id: r.id };
    });
  }

  const lines = out.order_intent.lines.filter((l) => l.product_id && typeof l.quantity === "number" && l.quantity > 0);
  if (lines.length) {
    await act(c, "create_draft_order", T.order[lang](lines.length), out.order_intent, async (w) => {
      const o = await w.insert("sales_order", { account_id: account.id, deal_id: dealId, rep_id: me.id, status: "draft", source: "voice", order_date: day, voice_log_id: c.voiceLogId });
      let n = 0;
      for (const l of lines) {
        const prod = x.products.find((p) => p.id === l.product_id)!;
        await w.insert("order_line", { order_id: o.id, line_no: ++n, product_id: prod.id, quantity: l.quantity, unit_price_minor: prod.list_price_minor, discount_pct: null });
      }
      return { table: "sales_order", id: o.id };
    });
  }

  const approvals: ApprovalCard[] = [];
  if (out.follow_up.intent) {
    const ap = await followUp(c, out, account, contactIdByName, deps, api);
    if (ap) approvals.push(ap);
  }
  return { approvals, visitId };
}

/**
 * REQ-DEB-005: the follow-up goes through fn:draft-message's draftMessage (WP-APR-01): drafted in the rep's style as a
 * pending customer_message approval (ai_action send_* suggested, approval + message_approval). Never sent here.
 * On top: Rule A (a draft that states a number not in the facts is replaced by a facts-only template) and the
 * card line summary stored as the ai_action reason, so fn:debrief-result-get rebuilds the same line.
 */
async function followUp(c: Ctx, out: DebriefOutput, account: Row<"account">, contactIdByName: Map<string, string>, deps: DebriefDeps, api: ApiLike | null): Promise<ApprovalCard | null> {
  const { db, me, lang } = c;
  const fu = out.follow_up;
  const channel = fu.channel;
  const contacts = await db.contact.all({ account_id: account.id });
  const key = fu.contact_name ? latinKey(fu.contact_name) : "";
  const named = key ? contacts.find((k) => k.id === contactIdByName.get(key) || latinKey(k.full_name) === key || latinKey(k.full_name).split(" ")[0] === key.split(" ")[0]) ?? null : null;
  const addr = (k: { email?: string | null; phone?: string | null }) => (channel === "email" ? k.email : k.phone)?.trim() || null;
  const contact = named && addr(named) ? named : contacts.filter((k) => addr(k)).sort((p, q) => Number(q.is_decision_maker) - Number(p.is_decision_maker))[0] ?? null;
  if (!(contact && addr(contact)) && !addr(account)) { out.missing_fields.push({ field: "/follow_up/recipient", question: T.qRecipient[lang](channel) }); return null; }

  const promises = out.tasks.filter((t) => t.is_customer_promise).map((t) => `${t.title}${t.due_at ? ` (${t.due_at})` : ""}`);
  let res: { approval_id: string; ai_action_id: string };
  try {
    res = await draftMessage(db, me, { account_id: account.id, contact_id: contact?.id ?? null, intent: fu.intent, channel, context: promises.length ? promises.join("; ") : null, on_behalf_of: me.id, voice_log_id: c.voiceLogId }, { model: deps.draftModel, api, now: deps.now });
  } catch (e) {
    const msg = String((e as { message?: unknown })?.message ?? e).slice(0, 120);
    deps.log?.(`debrief-process: draft-message failed: ${msg}`);
    out.missing_fields.push({ field: "/follow_up", question: T.qDraft[lang](msg) });
    return null;
  }
  const ap = await db.approval.require(res.approval_id);
  const m = (await db.message_approval.findOne({ approval_id: ap.id }))!;
  const allowed = [fu.intent, ...promises, account.name, me.user.full_name, contact?.full_name ?? ""];
  let body = m.draft_body, subject = m.subject ?? null;
  if (unknownNumbers(`${subject ?? ""} ${body}`, allowed).length) {
    const first = contact ? ` ${contact.full_name.split(" ")[0]}` : "";
    body = `${lang === "el" ? `Καλησπέρα${first},` : `Hello${first},`}\n\n${fu.intent}\n\n${me.user.full_name}`;
    await db.message_approval.update(m.id, { draft_body: body } as never);
    deps.log?.("debrief-process: draft stated a number not in the facts; replaced by the facts-only template (Rule A)");
  }
  const code = channel === "email" ? "send_email" : channel === "whatsapp" ? "send_whatsapp" : "send_viber";
  const summary = T.draft[lang](channel, contact?.full_name ?? account.name);
  await db.ai_action.update(res.ai_action_id, { reason: summary } as never);
  c.lines.push({ ai_action_id: res.ai_action_id, action_type: code, action_class: "external", status: "suggested", summary, target_table: "message_approval", target_id: m.id, undoable: false, approval_id: ap.id });
  const preview = (subject ? `${subject}: ` : "") + body.replace(/\s+/g, " ").slice(0, 160);
  return approvalCard(ap, me.user, me.user, account, { channel, recipient: m.recipient_address, subject, body, preview });
}

const userRef = (u: Row<"app_user">) => ({ id: u.id, full_name: u.full_name, role: u.role_code as "rep" | "manager" | "admin" });
const iso = (v: unknown, fallback: string) => typeof v === "number" && v > 0 ? new Date(v).toISOString() : typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : fallback;
export function approvalCard(ap: Row<"approval">, requester: Row<"app_user">, approver: Row<"app_user">, account: Row<"account"> | null, m: { channel: string | null; recipient: string | null; subject: string | null; body: string | null; preview: string }): ApprovalCard {
  return {
    approval_id: ap.id, kind: ap.kind as ApprovalCard["kind"], status: ap.status as ApprovalCard["status"], mode: ap.mode as ApprovalCard["mode"],
    account: account ? accountRef(account) : null, requested_by: userRef(requester), approver: userRef(approver), preview: m.preview,
    channel: m.channel, recipient: m.recipient, subject: m.subject, body: m.body, decision_note: ap.decision_note ?? null,
    due_at: ap.due_at ?? null, expires_at: ap.expires_at ?? null, created_at: iso((ap as { created_at?: unknown }).created_at, new Date().toISOString()),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Account resolution when the request names none (unknown customer -> needs_confirmation with candidates).
const haversine = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = (d: number) => (d * Math.PI) / 180, R = 6371000;
  const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
};
export async function resolveAccount(db: Db, me: UserPrincipal, utterance: string, day: string, lat: number | null | undefined, lng: number | null | undefined, lang: Lang): Promise<{ account: Row<"account"> | null; candidates: AccountRef[]; question: string | null }> {
  const all = (await listAccounts(db, me, {}, { limit: 1000 })).items;
  const named = accountsMentioned(utterance, all);
  if (named.length === 1) return { account: named[0]!, candidates: [], question: null };
  let cands: AccountRef[] = named.map((a) => accountRef(a, { reason: "named in the debrief" }));
  if (!cands.length) {
    const visits = await db.visit.all({ rep_id: me.id, planned_date: day });
    const ids = new Set(visits.map((v) => v.account_id));
    cands = all.filter((a) => ids.has(a.id)).map((a) => accountRef(a, { reason: "on today's plan" }));
  }
  if (typeof lat === "number" && typeof lng === "number") {
    const near = all.filter((a) => typeof a.lat === "number" && typeof a.lng === "number").map((a) => ({ a, d: haversine({ lat, lng }, { lat: a.lat as number, lng: a.lng as number }) })).sort((p, q) => p.d - q.d).slice(0, 3);
    for (const { a, d } of near) if (!cands.some((c) => c.id === a.id)) cands.push(accountRef(a, { distance_m: d, reason: "nearby" }));
    else cands = cands.map((c) => (c.id === a.id ? { ...c, distance_m: d } : c));
  }
  const dist = (c: AccountRef) => (typeof c.distance_m === "number" ? c.distance_m : Number.POSITIVE_INFINITY);
  cands = [...cands].sort((p, q) => dist(p) - dist(q));
  return { account: null, candidates: cands.slice(0, 5), question: T.qAccount[lang] };
}

// ---------------------------------------------------------------------------------------------------------
// ResultCard from stored rows (shared with fn:debrief-result-get, so both return the same card).
export interface CardMeta { missing_fields: Missing[]; spoken_summary: string; language: Lang }
export async function cardFromRows(db: Db, voiceLog: Row<"voice_log">): Promise<Card> {
  if (!voiceLog.account_id) throw notFound("this debrief has no customer yet", { voice_log_id: voiceLog.id, status: voiceLog.status });
  const account = await db.account.require(voiceLog.account_id);
  const actions = (await db.ai_action.all({ voice_log_id: voiceLog.id })).sort((a, b) => Number(a.created_at ?? 0) - Number(b.created_at ?? 0) || 0);
  const types = new Map((await db.action_type.all()).map((t) => [t.code, t.action_class as ActionClass]));
  const approvals = actions.length ? await db.approval.all({ ai_action_id: actions.map((a) => a.id) }) : [];
  const lines: Line[] = actions.map((a) => {
    const ap = approvals.find((x) => x.ai_action_id === a.id);
    const cls = types.get(a.action_type_code) ?? "internal";
    return { ai_action_id: a.id, action_type: a.action_type_code, action_class: cls, status: a.status as Line["status"], summary: a.reason ?? a.action_type_code, target_table: a.target_table ?? null, target_id: a.target_id ?? null, undoable: a.status === "applied" && (cls === "internal" || cls === "draft"), approval_id: ap?.id ?? null };
  });
  const meta = metaOf(actions);
  const pending: ApprovalCard[] = [];
  const users = new Map<string, Row<"app_user">>();
  const user = async (id: string): Promise<Row<"app_user">> => {
    const hit = users.get(id);
    if (hit) return hit;
    const u = await db.app_user.require(id);
    users.set(id, u);
    return u;
  };
  for (const ap of approvals.filter((a) => a.status === "pending")) {
    const m = await db.message_approval.findOne({ approval_id: ap.id });
    const preview = m ? (m.subject ? `${m.subject}: ` : "") + (m.final_body ?? m.draft_body).replace(/\s+/g, " ").slice(0, 160) : ap.kind;
    pending.push(approvalCard(ap, await user(ap.requested_by), await user(ap.approver_id), account, { channel: m?.channel_code ?? null, recipient: m?.recipient_address ?? null, subject: m?.subject ?? null, body: m ? (m.final_body ?? m.draft_body) : null, preview }));
  }
  const missing = meta?.missing_fields ?? [];
  const lang: Lang = meta?.language ?? (voiceLog.language === "en" ? "en" : "el");
  return {
    voice_log_id: voiceLog.id, account: accountRef(account), lines, missing_fields: missing, pending_approvals: pending,
    spoken_summary: spokenSummary(lines, pending, missing, lang), processing_ms: Math.max(0, Math.round(Number(voiceLog.processing_ms ?? 0))),
  };
}
/** The card meta (missing fields, language) travels in the create_note ai_action payload. */
function metaOf(actions: Row<"ai_action">[]): CardMeta | null {
  const note = actions.find((a) => a.action_type_code === "create_note");
  try { const p = JSON.parse(note?.payload_json ?? "null"); return p && p.card ? (p.card as CardMeta) : null; } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------------
// The handler.
const PROCESSABLE = new Set(["uploaded", "processing", "needs_confirmation", "failed", "transcribing", "offline"]);
const rand = () => Math.random().toString(36).slice(2, 10);

export function makeImpl(deps: DebriefDeps): Impl<"debrief-process"> {
  return async ({ req, db, me, platform }) => {
    const now = deps.now ?? Date.now;
    const t0 = now();
    const hasLog = !!req.voice_log_id, hasText = typeof req.utterance === "string" && req.utterance.trim() !== "";
    if (hasLog === hasText) throw invalid("send exactly one of voice_log_id or utterance");
    const day = today(me.org, t0);
    const nowIso = new Date(t0).toISOString();

    // 1. the voice log (owner only), or a new one for a typed / buddy debrief
    let vl: Row<"voice_log">;
    if (req.voice_log_id) {
      vl = await db.voice_log.require(req.voice_log_id);
      assertOwner(me, vl.rep_id, "voice log");
      if (vl.status === "completed") return { status: "completed", result: await cardFromRows(db, vl), candidates: [], question: null };
      if (!PROCESSABLE.has(vl.status)) throw invalid(`voice log is ${vl.status}`);
      if (!vl.transcript?.trim()) throw blocked("this voice log has no transcript yet (transcription pending)", { voice_log_id: vl.id, status: vl.status });
    } else {
      let transcript = req.utterance!.trim();
      if (req.corrects_voice_log_id) {
        // A fix of a debrief already logged: undo all its applied lines, then re-log the original words plus the fix.
        const orig = await db.voice_log.require(req.corrects_voice_log_id);
        assertOwner(me, orig.rep_id, "voice log");
        if (orig.status !== "completed" || !orig.account_id) throw invalid(`only a completed debrief can be corrected (voice log is ${orig.status})`);
        if (req.account_id && req.account_id !== orig.account_id) throw invalid("a correction keeps the account of the debrief it corrects");
        req = { ...req, account_id: orig.account_id };
        const acts = (await db.ai_action.all({ voice_log_id: orig.id })).filter((a) => a.status === "applied")
          .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0));
        for (const a of acts) {
          try { await undo(db, me, a.id, { now: t0 }); } catch (e) { deps.log?.(`debrief-process correction: could not undo ${a.id} (${a.action_type_code}): ${(e as Error).message}`); }
        }
        transcript = `${orig.transcript?.trim() ?? ""} Correction: ${transcript}`.trim();
      }
      vl = await db.voice_log.insert({
        rep_id: me.id, account_id: null, capture_mode: req.conversation_id ? "live_buddy" : "typed", wonderful_conversation_id: req.conversation_id ?? null,
        language: req.language ?? null, transcript, status: "processing", idempotency_key: `debrief:${me.id}:${t0}:${rand()}`, recorded_at: nowIso,
      } as never);
    }
    const utterance = vl.transcript!.trim();
    const lang0 = langOf(null, req.language ?? vl.language);

    // 2. the customer
    let account: Row<"account"> | null = null;
    const accountId = req.account_id ?? vl.account_id ?? null;
    if (accountId) account = await requireAccount(db, me, accountId);
    else {
      const r = await resolveAccount(db, me, utterance, day, req.lat, req.lng, lang0);
      account = r.account;
      if (!account) {
        await db.voice_log.update(vl.id, { status: "needs_confirmation" } as never);
        return { status: "needs_confirmation", result: null, candidates: r.candidates, question: r.question };
      }
    }
    if (vl.account_id !== account.id || vl.status !== "processing") vl = await db.voice_log.update(vl.id, { account_id: account.id, status: "processing" } as never);

    // 3. extraction + grounding
    const x = await extractionInput(db, me, account, utterance, req.language ?? vl.language ?? null, day);
    const ex = await deps.extract(x.input, EXTRACT_RULES);
    for (const l of ex.logs) deps.log?.(l);
    if (!ex.ok) {
      await db.voice_log.update(vl.id, { status: "failed", error: `${ex.error.code}: ${ex.error.message}`.slice(0, 500), processed_at: new Date(now()).toISOString(), processing_ms: now() - t0 } as never);
      return { status: "failed", result: null, candidates: [], question: lang0 === "el" ? "Δεν κατάφερα να επεξεργαστώ την ενημέρωση. Θες να το ξαναπείς;" : "I could not process that debrief. Could you say it again?" };
    }
    const { out, dropped } = groundOutput(ex.value, x, utterance, day);
    const lang = langOf(out, req.language === "en" || req.language === "el" ? req.language : null);
    if (dropped.length) deps.log?.(`debrief-process dropped ${dropped.length}: ${JSON.stringify(dropped).slice(0, 800)}`);

    // 4. actions
    const c: Ctx = { db, me, voiceLogId: vl.id, lang, nowIso, lines: [] };
    const api = (platform as { api?: ApiLike | null }).api ?? null;
    const { approvals, visitId } = await applyOutput(c, x, out, account, vl.visit_id ?? null, day, deps, api);

    // 5. card meta on the note action, voice log completed, live push
    const meta: CardMeta = { missing_fields: out.missing_fields, spoken_summary: spokenSummary(c.lines, approvals, out.missing_fields, lang), language: lang };
    const noteLine = c.lines.find((l) => l.action_type === "create_note");
    if (noteLine) await db.ai_action.update(noteLine.ai_action_id, { payload_json: JSON.stringify({ note: out.note, card: meta, dropped }) } as never);
    const ms = Math.max(0, Math.round(now() - t0));
    vl = await db.voice_log.update(vl.id, { status: "completed", language: out.language, visit_id: visitId, processed_at: new Date(now()).toISOString(), processing_ms: ms, error: null } as never);
    const card: Card = { voice_log_id: vl.id, account: accountRef(account), lines: c.lines, missing_fields: out.missing_fields, pending_approvals: approvals, spoken_summary: meta.spoken_summary, processing_ms: ms };
    await pushToRepAndTeams({ api }, db, me.id, "result_card.ready", { voice_log_id: vl.id, result: card });
    return { status: "completed", result: card, candidates: [], question: out.missing_fields[0]?.question ?? null };
  };
}

export const impl = makeImpl(runtimeDeps);

/** Wonderful Function entry: like defineFunction, but passes context.api through so the result_card.ready push works. */
export function makeHandle(deps: DebriefDeps) {
  const run = makeImpl(deps);
  return (context: FunctionContext & { api?: ApiLike | null }) => {
    const ws = (context.metadata as { workspaceId?: unknown } | null | undefined)?.workspaceId;
    const platform = { secrets: context.secrets ?? null, globals: context.globals ?? null, workspaceId: typeof ws === "string" ? ws : null, api: context.api ?? null };
    return runFunction("debrief-process", run, { tables: context.tables, data: context.data, principal: () => principalFromFunction(context.tables, context), platform });
  };
}
export const handle = makeHandle({ ...runtimeDeps, log: (m) => console.log(m) });
