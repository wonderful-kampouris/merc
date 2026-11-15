// fn:buddy-call-start (contracts/functions/buddy-call-start.json, REQ-BUD-013/014/015, REQ-MTG-001/005/006).
// merc-buddy reaches the rep: one outbound call (POST /v1/agents/outbound from MERC_BUDDY_NUMBER) or one WhatsApp
// message (template, or interactive free-form inside the 24 h window). The target is ALWAYS the caller's own
// app_user.phone, never a request field. Also used by buddy-callbacks-due (scheduled rows) and buddy-call-outcome.
//
// Live sends are behind config (WP-BUD-03, nothing real is ever sent by tests or smoke calls):
//   - global MERC_CHANNELS_LIVE must be boolean true, else the row is `failed` / `channels_not_live` and the exact
//     request body is logged (evidence of what would have been sent);
//   - WhatsApp needs global MERC_WHATSAPP_CONNECTION (connectionName) and a runtime `context.outbound`
//     (agent tools only), else `failed` / `whatsapp_not_configured` (no throw);
//   - calls need MERC_BUDDY_NUMBER and a service account (context.api), else `failed` with the reason.
import {
  addDays, createDb, defineCron, defineFunction, runAsTool, forbidden, globalString, secretString, invalid, localParts, withinLocalHours, zonedInstant,
  type Db, type FunctionContext, type FunctionSlug, type Impl, type PlatformLike, type TablesApi, type Principal, type Row, type ToolContext, type UserPrincipal,
} from "../../core/src/index";
import { push, repChannel, type ApiLike, type Logger } from "../../live/src/index";

// ---- config ----------------------------------------------------------------------------------------------
export const GLOBAL_BUDDY_NUMBER = "MERC_BUDDY_NUMBER";
export const GLOBAL_WHATSAPP_CONNECTION = "MERC_WHATSAPP_CONNECTION";
export const GLOBAL_CHANNELS_LIVE = "MERC_CHANNELS_LIVE";
/** MERC_WHATSAPP_CONNECTION value meaning "the tenant's only WhatsApp connection" (no connectionName sent). */
export const WHATSAPP_DEFAULT_CONNECTION = "default";
/**
 * WhatsApp relay (Functions have no context.outbound, spike S3): a Function that must send WhatsApp POSTs the
 * buddy_call id to the merc-ops webhook trigger (task_type whatsapp_send). The merc-ops tool deliver_whatsapp then
 * runs startNow for that row inside an agent runtime, where context.outbound exists. Row status while relayed:
 * channel whatsapp + status started (WhatsApp rows are otherwise never "started").
 */
export const GLOBAL_WA_RELAY_URL = "MERC_OPS_WHATSAPP_URL";
export const NAME_WA_RELAY_HOOK = "MERC_OPS_WHATSAPP_HOOK";
export const WA_RELAY_TASK_TYPE = "whatsapp_send";
export const WA_RELAY_HEADER = "X-Webhook-Secret";
export const OUTBOUND_PATH = "/v1/agents/outbound";
export const CALL_PURPOSE_PREFIX = "merc_buddy:";
/** REQ-BUD-014: outbound buddy calls only between 07:30 and 21:00 org time. WhatsApp has no hour limit. */
export const CALL_HOURS = { start: "07:30", end: "21:00" } as const;
export const ANSWER_TIMEOUT_S = 25;
/** Idempotency window on (user, purpose, ref_id). */
export const DEDUPE_MS = 10 * 60_000;
export const E164 = /^\+[1-9]\d{6,14}$/;

export const TEMPLATES = { ping: "merc_buddy_ping", pre_visit: "merc_previsit_brief", debrief_confirm: "merc_debrief_confirm" } as const;
/** Quick replies from contracts/platform/platform.json integrations.whatsapp.templates. Titles max 20 chars. */
export const QUICK_REPLIES = {
  pre_visit: [{ id: "call_me", title: "Call me" }, { id: "useful", title: "Useful" }, { id: "not_useful", title: "Not useful" }],
  debrief_confirm: [{ id: "correct", title: "Correct" }, { id: "fix", title: "Fix" }, { id: "brief_not_helpful", title: "Brief did not help" }],
  post_visit: [{ id: "call_me", title: "Call me" }],
} as const;

/** Runtime WhatsApp sender (context.outbound in agent tools; absent in Functions per spike S3). */
export interface WhatsAppOutbound {
  whatsapp?: {
    sendTemplate?: (o: { destination: string; templateName: string; languageCode: string; templateParams?: string[]; connectionName?: string }) => unknown;
    sendInteractive?: (o: { destination: string; message: string; interaction: { type: "buttons"; buttons: Array<{ id: string; title: string }> }; connectionName?: string }) => unknown;
  } | null;
}
export type RelayFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;
export interface BuddyDeps { api?: ApiLike | null; outbound?: WhatsAppOutbound | null; now?: () => number; log?: Logger; fetch?: RelayFetch | null }
export const nowOf = (d: BuddyDeps) => (d.now ? d.now() : Date.now());
export const isoAt = (ms: number) => new Date(ms).toISOString();
const defaultLog: Logger = (level, message, details) => { try { console.log(JSON.stringify({ level, message, ...(details ?? {}) })); } catch { /* logging never breaks a send */ } };
export const logOf = (d: BuddyDeps): Logger => d.log ?? defaultLog;

/** A global as boolean: true only for boolean true or the string "true". */
export function globalFlag(platform: PlatformLike, name: string): boolean {
  let v: unknown;
  try { v = platform.globals?.get(name); } catch { v = null; }
  return v === true || (typeof v === "string" && v.trim().toLowerCase() === "true");
}

// ---- call hours ------------------------------------------------------------------------------------------
/** The first instant >= ms inside the call window, in the org timezone. */
export function nextCallSlot(org: { timezone: string }, ms: number): number {
  if (withinLocalHours(org, CALL_HOURS.start, CALL_HOURS.end, ms)) return ms;
  const lp = localParts(org, ms);
  const day = lp.time < CALL_HOURS.start ? lp.date : addDays(lp.date, 1);
  return Date.parse(zonedInstant(org, day, CALL_HOURS.start));
}

// ---- content ---------------------------------------------------------------------------------------------
type Lang = "el" | "en";
export const langOf = (u: Row<"app_user">, org: Row<"organization">): Lang => ((u.preferred_language || org.default_language) === "en" ? "en" : "el");
const first = (u: { full_name: string }) => u.full_name.split(/\s+/)[0] ?? u.full_name;

const DEFAULT_REASON: Record<Row<"buddy_call">["purpose"], Record<Lang, string>> = {
  callback: { en: "You asked Merc to call you back.", el: "Ζήτησες από το Merc να σε καλέσει." },
  briefing: { en: "Your morning briefing is ready.", el: "Η πρωινή σου ενημέρωση είναι έτοιμη." },
  approval_decided: { en: "Your approval has been decided.", el: "Υπάρχει απόφαση για την έγκρισή σου." },
  alert: { en: "There is a new alert for you.", el: "Υπάρχει νέα ειδοποίηση για σένα." },
  eod: { en: "Time to wrap up your day.", el: "Ώρα να κλείσουμε τη μέρα." },
  pre_visit: { en: "Your visit brief is ready.", el: "Το brief της επίσκεψης είναι έτοιμο." },
  post_visit: { en: "How did the visit go?", el: "Πώς πήγε η επίσκεψη;" },
  debrief_confirm: { en: "Here is the summary of your debrief.", el: "Η σύνοψη της αναφοράς σου." },
};

export interface Message {
  template: string;
  params: string[];
  /** Free-form body for the interactive message inside the 24 h window. */
  text: string;
  buttons: Array<{ id: string; title: string }>;
  /** What the buddy says first on an outbound call (call_purpose context). */
  spoken: string;
}

async function accountName(db: Db, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  return (await db.account.get(id))?.name ?? null;
}

/** Content per purpose, built from rows (no LLM). Missing refs fall back to the generic ping. */
export async function buildMessage(db: Db, row: Row<"buddy_call">, user: Row<"app_user">, org: Row<"organization">): Promise<Message> {
  const lang = langOf(user, org);
  const name = first(user);
  const reason = (row.reason ?? "").trim() || DEFAULT_REASON[row.purpose][lang];
  const ping: Message = {
    template: TEMPLATES.ping, params: [name, reason], buttons: [],
    text: lang === "en" ? `Merc: ${reason} Reply or call back.` : `Merc: ${reason} Απάντησε ή κάλεσε πίσω.`,
    spoken: reason,
  };
  if (row.purpose === "pre_visit" && row.ref_id) {
    const brief = await db.visit_brief.get(row.ref_id);
    if (brief && brief.rep_id === user.id) {
      const acct = (await accountName(db, brief.account_id)) ?? "";
      const bullets = (brief.bullets_text ?? "").trim();
      return {
        template: TEMPLATES.pre_visit, params: [name, acct, bullets], buttons: [...QUICK_REPLIES.pre_visit],
        text: (acct ? `*${acct}*\n${bullets}` : bullets).trim(), spoken: (brief.spoken_script ?? "").trim() || reason,
      };
    }
  }
  if (row.purpose === "post_visit" && row.ref_id) {
    const visit = await db.visit.get(row.ref_id);
    if (visit && visit.rep_id === user.id) {
      const acct = (await accountName(db, visit.account_id)) ?? "";
      const q = lang === "en" ? `How did it go at ${acct}?` : `Πώς πήγε στο ${acct};`;
      return { template: TEMPLATES.ping, params: [name, q], text: q, buttons: [...QUICK_REPLIES.post_visit], spoken: q };
    }
  }
  if (row.purpose === "debrief_confirm" && row.ref_id) {
    const dc = await db.debrief_confirmation.get(row.ref_id);
    if (dc && dc.rep_id === user.id) {
      const summary = (dc.summary_text ?? "").trim();
      return { template: TEMPLATES.debrief_confirm, params: [name, summary], text: summary, buttons: [...QUICK_REPLIES.debrief_confirm], spoken: summary || reason };
    }
  }
  return ping;
}

// ---- target ----------------------------------------------------------------------------------------------
export type Block = "rep_has_no_phone" | "phone_channel_disabled";
/** The rep's own number, or why there is none. Never a request field (REQ-BUD-014). */
export function repNumber(u: Row<"app_user">): { ok: true; number: string } | { ok: false; reason: Block } {
  if (u.phone_channel_enabled === false) return { ok: false, reason: "phone_channel_disabled" };
  if (!u.phone || !E164.test(u.phone)) return { ok: false, reason: "rep_has_no_phone" };
  return { ok: true, number: u.phone };
}
export const inWhatsAppWindow = (u: Row<"app_user">, now: number) => !!u.whatsapp_window_until && Date.parse(u.whatsapp_window_until) > now;
/** "Has WhatsApp": a valid own number and a configured Merc WhatsApp connection. */
export const hasWhatsApp = (u: Row<"app_user">, platform: PlatformLike) => repNumber(u).ok && !!globalString(platform, GLOBAL_WHATSAPP_CONNECTION);

// ---- start one row now -----------------------------------------------------------------------------------
const idOf = (res: unknown): string | null => {
  const r = (res && typeof res === "object" && "data" in (res as object) ? (res as { data: unknown }).data : res) as Record<string, unknown> | null;
  for (const k of ["communication_id", "conversation_id", "id"]) if (r && typeof r[k] === "string" && r[k]) return r[k] as string;
  return null;
};
const errText = (e: unknown) => {
  const status = (e as { status?: unknown })?.status;
  const payload = (e as { payload?: unknown; body?: unknown })?.payload ?? (e as { body?: unknown })?.body;
  let extra = "";
  try { extra = payload === undefined ? "" : ` ${typeof payload === "string" ? payload : JSON.stringify(payload)}`; } catch { extra = ""; }
  return `${typeof status === "number" ? status : "error"}: ${String((e as Error)?.message ?? e).slice(0, 200)}${extra.slice(0, 300)}`;
};

export type StartStatus = "scheduled" | "started" | "sent" | "failed";
export interface Started { row: Row<"buddy_call">; status: StartStatus; request?: { path: string; body: Record<string, unknown> } }

async function finish(db: Db, deps: BuddyDeps, row: Row<"buddy_call">, patch: Partial<Row<"buddy_call">>, request?: Started["request"]): Promise<Started> {
  const r = await db.buddy_call.update(row.id, patch);
  await push(deps, "buddy_call.status", { buddy_call_id: r.id, channel: r.channel, status: r.status }, repChannel(r.user_id), { now: deps.now, log: logOf(deps) });
  return { row: r, status: (r.status === "scheduled" || r.status === "sent" || r.status === "failed" ? r.status : "started") as StartStatus, request };
}

/**
 * Start a buddy_call row now: dial or message the rep once. Outside call hours a call is re-scheduled to the next
 * slot. Every refusal is recorded on the row (status failed + failure_reason), never thrown.
 */
export async function startNow(db: Db, platform: PlatformLike, deps: BuddyDeps, row: Row<"buddy_call">, user: Row<"app_user">, org: Row<"organization">): Promise<Started> {
  const now = nowOf(deps);
  const log = logOf(deps);
  const target = repNumber(user);
  if (!target.ok) return finish(db, deps, row, { status: "failed", failure_reason: target.reason, ended_at: isoAt(now) });
  const msg = await buildMessage(db, row, user, org);
  const live = globalFlag(platform, GLOBAL_CHANNELS_LIVE);

  if (row.channel === "call") {
    const slot = nextCallSlot(org, now);
    if (slot > now) return finish(db, deps, row, { status: "scheduled", due_at: isoAt(slot) });
    const from = globalString(platform, GLOBAL_BUDDY_NUMBER);
    const body = { from: from ?? `<${GLOBAL_BUDDY_NUMBER} unset>`, to: target.number, call_purpose: `${CALL_PURPOSE_PREFIX}${row.id}:${row.purpose}`, answer_timeout_after_progress_seconds: ANSWER_TIMEOUT_S };
    const request = { path: OUTBOUND_PATH, body };
    if (!from || !E164.test(from)) return finish(db, deps, row, { status: "failed", failure_reason: `no_caller_id: global ${GLOBAL_BUDDY_NUMBER} is not set`, ended_at: isoAt(now) }, request);
    if (!live) {
      log("warn", `buddy_call ${row.id}: ${GLOBAL_CHANNELS_LIVE} is not true; outbound call NOT placed`, { would_post: request });
      return finish(db, deps, row, { status: "failed", failure_reason: `channels_not_live: would POST ${OUTBOUND_PATH} ${JSON.stringify(body)}`.slice(0, 500), ended_at: isoAt(now) }, request);
    }
    if (!deps.api) return finish(db, deps, row, { status: "failed", failure_reason: "no_service_account: context.api unavailable (pin service account merc-platform-api)", ended_at: isoAt(now) }, request);
    try {
      const res = await deps.api.post(OUTBOUND_PATH, { body });
      const conv = idOf(res);
      log("info", `buddy_call ${row.id}: calling the rep`, { conversation_id: conv });
      return finish(db, deps, row, { status: "started", started_at: isoAt(now), ...(conv ? { wonderful_conversation_id: conv } : {}) }, request);
    } catch (e) {
      return finish(db, deps, row, { status: "failed", failure_reason: `outbound call could not start (${errText(e)})`, ended_at: isoAt(nowOf(deps)) }, request);
    }
  }

  // WhatsApp
  const connectionName = globalString(platform, GLOBAL_WHATSAPP_CONNECTION);
  // "default" = the tenant's only WhatsApp connection: send without connectionName (it is optional on the builtin).
  const named = connectionName && connectionName.trim().toLowerCase() !== WHATSAPP_DEFAULT_CONNECTION ? { connectionName } : {};
  const interactive = inWhatsAppWindow(user, now);
  const lang = langOf(user, org);
  const body: Record<string, unknown> = interactive
    ? { destination: target.number, message: msg.text, interaction: { type: "buttons", buttons: msg.buttons.length ? msg.buttons : [{ id: "call_me", title: "Call me" }] }, ...named }
    : { destination: target.number, templateName: msg.template, languageCode: lang === "en" ? "en_US" : "el", templateParams: msg.params, ...named };
  const request = { path: interactive ? "outbound.whatsapp.sendInteractive" : "outbound.whatsapp.sendTemplate", body };
  const tpl = interactive ? null : msg.template;
  if (!connectionName) {
    log("warn", `buddy_call ${row.id}: WhatsApp not configured (global ${GLOBAL_WHATSAPP_CONNECTION} missing)`, { would_send: request });
    return finish(db, deps, row, { status: "failed", template_name: tpl, failure_reason: "whatsapp_not_configured", ended_at: isoAt(now) }, request);
  }
  if (!live) {
    log("warn", `buddy_call ${row.id}: ${GLOBAL_CHANNELS_LIVE} is not true; WhatsApp NOT sent`, { would_send: request });
    return finish(db, deps, row, { status: "failed", template_name: tpl, failure_reason: "channels_not_live", ended_at: isoAt(now) }, request);
  }
  const wa = deps.outbound?.whatsapp;
  const send = interactive ? wa?.sendInteractive : wa?.sendTemplate;
  if (!send) {
    // Function runtime: hand the row to merc-ops, which sends it from an agent runtime (see GLOBAL_WA_RELAY_URL).
    const relay = await relayWhatsApp(platform, deps, row.id);
    if (relay.ok) {
      log("info", `buddy_call ${row.id}: WhatsApp relayed to merc-ops`, { status: relay.status });
      return finish(db, deps, row, { status: "started", template_name: tpl, started_at: isoAt(now) }, request);
    }
    return finish(db, deps, row, { status: "failed", template_name: tpl, failure_reason: `whatsapp_not_configured: no context.outbound in this runtime; relay ${relay.error}`.slice(0, 500), ended_at: isoAt(now) }, request);
  }
  try {
    await (send as (o: unknown) => unknown).call(wa, body);
    return finish(db, deps, row, { status: "sent", template_name: tpl, started_at: isoAt(now), ended_at: isoAt(now) }, request);
  } catch (e) {
    return finish(db, deps, row, { status: "failed", template_name: tpl, failure_reason: `whatsapp send failed (${errText(e)})`, ended_at: isoAt(nowOf(deps)) }, request);
  }
}

// ---- WhatsApp relay through merc-ops ---------------------------------------------------------------------------
const relayFetchOf = (deps: BuddyDeps): RelayFetch | null =>
  deps.fetch ?? (typeof (globalThis as { fetch?: unknown }).fetch === "function" ? ((url, init) => (globalThis as any).fetch(url, init)) : null);

/** POST {task_type, buddy_call_id} to the merc-ops whatsapp_send webhook. Never throws. */
export async function relayWhatsApp(platform: PlatformLike, deps: BuddyDeps, buddyCallId: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = globalString(platform, GLOBAL_WA_RELAY_URL);
  const key = secretString(platform, NAME_WA_RELAY_HOOK);
  if (!url || !key) return { ok: false, status: 0, error: `not wired (global ${GLOBAL_WA_RELAY_URL} and secret ${NAME_WA_RELAY_HOOK} needed)` };
  const f = relayFetchOf(deps);
  if (!f) return { ok: false, status: 0, error: "no fetch in this runtime" };
  const payload = { task_type: WA_RELAY_TASK_TYPE, buddy_call_id: buddyCallId, instructions: `Call deliver_whatsapp with buddy_call_id=${buddyCallId}, then finish the task.` };
  try {
    const res = await f(url, { method: "POST", headers: { "Content-Type": "application/json", [WA_RELAY_HEADER]: key }, body: JSON.stringify(payload) });
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, error: errText(e) };
  }
}

/**
 * merc-ops tool deliver_whatsapp: send one relayed WhatsApp buddy_call from an agent runtime (deps.outbound set).
 * Only rows that are relayed (channel whatsapp, status started) are sent, so a row is never sent twice.
 */
export async function deliverRelayedWhatsApp(tables: TablesApi, platform: PlatformLike, deps: BuddyDeps, buddyCallId: string): Promise<{ buddy_call_id: string; status: string; failure_reason?: string | null; skipped?: string }> {
  const root = createDb(tables);
  const row = await root.buddy_call.get(buddyCallId);
  if (!row) return { buddy_call_id: buddyCallId, status: "not_found", skipped: "no buddy_call with this id" };
  if (row.channel !== "whatsapp" || row.status !== "started") return { buddy_call_id: row.id, status: row.status, skipped: "not a relayed WhatsApp row" };
  if (!deps.outbound?.whatsapp) return { buddy_call_id: row.id, status: row.status, skipped: "no context.outbound in this runtime" };
  const user = await root.app_user.get(row.user_id);
  const org = user ? await root.organization.get(user.org_id) : null;
  if (!user || !org) return { buddy_call_id: row.id, status: row.status, skipped: "rep or org not found" };
  const out = await startNow(createDb(tables, user.org_id), platform, deps, row as Row<"buddy_call">, user, org);
  return { buddy_call_id: out.row.id, status: out.row.status, failure_reason: out.row.failure_reason ?? null };
}

// ---- fn:buddy-call-start -----------------------------------------------------------------------------------
const ACTIVE: Row<"buddy_call">["status"][] = ["scheduled", "started", "answered", "sent"];
const createdMs = (r: Row<"buddy_call">): number | null => {
  const c = (r as unknown as { created_at?: unknown }).created_at;
  const ms = typeof c === "number" ? c : typeof c === "string" ? Date.parse(c) : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
};
const asResponse = (s: Started) => ({ buddy_call_id: s.row.id, status: s.status, due_at: s.row.due_at, channel: s.row.channel });

/** The default channel: request, else a callback ("call me") is a phone call, else app_user.notify_channel (app -> call). */
export const channelFor = (req: { channel?: "call" | "whatsapp" | null; purpose?: string | null }, u: Row<"app_user">): "call" | "whatsapp" =>
  req.channel ?? (req.purpose === "callback" ? "call" : u.notify_channel === "whatsapp" ? "whatsapp" : "call");

/** Create (or reuse) the buddy_call row for one rep and start it now or schedule it. */
export async function requestBuddyCall(db: Db, platform: PlatformLike, deps: BuddyDeps, user: Row<"app_user">, org: Row<"organization">, req: { channel?: "call" | "whatsapp" | null; purpose: Row<"buddy_call">["purpose"]; reason?: string | null; at?: string | null; ref_table?: string | null; ref_id?: string | null }): Promise<Started> {
  const now = nowOf(deps);
  const channel = channelFor(req, user);
  const at = req.at ? Date.parse(req.at) : now;
  if (!Number.isFinite(at)) throw invalid("at must be an ISO date-time", { at: req.at });
  if (req.ref_id && !req.ref_table) throw invalid("ref_table is required with ref_id");
  const ref_id = req.ref_id ?? null;
  // Idempotent on (user, purpose, ref_id) for 10 min; a pending scheduled callback is moved instead of duplicated.
  const same = (await db.buddy_call.all({ user_id: user.id, purpose: req.purpose })).filter((r) => (r.ref_id ?? null) === ref_id && ACTIVE.includes(r.status));
  const pending = same.find((r) => r.status === "scheduled");
  // An answered or finished call is done: asking again ("call me" twice) places a new call.
  const recent = same.filter((r) => r.status !== "answered" && !r.ended_at).find((r) => { const c = r.started_at ? Date.parse(r.started_at) : createdMs(r); return c !== null && Math.abs(now - c) < DEDUPE_MS; });
  if (pending) {
    const due = channel === "call" ? nextCallSlot(org, Math.max(at, now)) : Math.max(at, now);
    const moved = await db.buddy_call.update(pending.id, { due_at: isoAt(due), channel, reason: req.reason ?? pending.reason ?? null });
    if (due > now) return { row: moved, status: "scheduled" };
    return startNow(db, platform, deps, moved, user, org);
  }
  if (recent) return { row: recent, status: recent.status === "sent" ? "sent" : "started" };

  const due = channel === "call" ? nextCallSlot(org, Math.max(at, now)) : Math.max(at, now);
  const row = await db.buddy_call.insert({
    user_id: user.id, channel, purpose: req.purpose, reason: req.reason ?? null, due_at: isoAt(due),
    ref_table: req.ref_table ?? null, ref_id, status: "scheduled",
  });
  if (due > now) {
    logOf(deps)("info", `buddy_call ${row.id} scheduled`, { due_at: row.due_at, channel });
    return { row, status: "scheduled" };
  }
  return startNow(db, platform, deps, row, user, org);
}

export function makeImpl(deps: BuddyDeps = {}): Impl<"buddy-call-start", Principal> {
  return async ({ req, db, me, platform }) => {
    if (me.kind !== "user") throw forbidden("buddy-call-start needs a Merc user: it only ever calls the caller's own phone");
    const out = await requestBuddyCall(db, platform, deps, me.user, me.org, req);
    return asResponse(out);
  };
}
export const impl = makeImpl() as Impl<"buddy-call-start", UserPrincipal>;

// ---- entries -----------------------------------------------------------------------------------------------
export const apiOf = (context: unknown): ApiLike | null => {
  const a = (context as { api?: ApiLike } | null)?.api;
  return a && typeof a.post === "function" ? a : null;
};
export const outboundOf = (context: unknown): WhatsAppOutbound | null => {
  const o = (context as { outbound?: WhatsAppOutbound } | null)?.outbound;
  return o && typeof o === "object" ? o : null;
};
export const depsFrom = (context: unknown, extra: BuddyDeps = {}): BuddyDeps => ({ api: apiOf(context), outbound: outboundOf(context), ...extra });
export function defineWithDeps<S extends FunctionSlug>(slug: S, make: (deps: BuddyDeps) => Impl<S, Principal>) {
  return (context: FunctionContext) => defineFunction(slug, make(depsFrom(context)) as Impl<S, UserPrincipal>)(context);
}
export function defineCronWithDeps<S extends FunctionSlug>(slug: S, make: (deps: BuddyDeps) => Impl<S, Principal>) {
  return (context: FunctionContext) => defineCron(slug, make(depsFrom(context)))(context);
}
export const handle = defineWithDeps("buddy-call-start", makeImpl);

/**
 * merc-buddy tool call_me_back (contracts/tools/merc-buddy/call_me_back.json): same impl, identity from the session
 * (signed Chat SDK claim, or the platform channel number on phone/WhatsApp, REQ-BUD-013). context.api and
 * context.outbound of the tool runtime are passed through, so WhatsApp can actually be sent from here.
 */
export function callMeBackTool(ctx: ToolContext & { api?: unknown; outbound?: unknown }, params: unknown, key: string, extra: BuddyDeps = {}) {
  return runAsTool("buddy-call-start", makeImpl(depsFrom(ctx, extra)) as Impl<"buddy-call-start", UserPrincipal>, ctx, params, key);
}
