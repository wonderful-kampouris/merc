// WP-BUD-01: the one wrapper every merc-buddy tool goes through (REQ-BUD-002/003/007).
// - identity: the signed Merc claim in communication.metadata (minted by fn:merc-chat-token), verified with
//   secret MERC_INTERNAL_CALL_KEY by @merc/core runAsTool. The model never fills `caller`.
// - injected values (conversation_id, language, device location, constants) come from the session, never the model.
// - customer memory: attach the resolved account so the platform preloads its memories.
import { forTextChannel, isTextChannel } from "./chat-format";
import { compactResult } from "./compact";
import { buddyDepsFrom, callerFromTool, runAsTool, secretString, TOOL_FACTORIES, type AnyImpl } from "./merc.gen.js";

/** Name of the Wonderful secret holding the HMAC key (identifier kept free of secret-like words for the scan). */
export const NAME_INTERNAL_KEY = "MERC_INTERNAL_CALL_KEY";
/**
 * DEMO ONLY, added at the team lead's request for the pitch ("remove the number verification"): global holding one
 * app_user phone (E.164). When set, a session with no signed claim (console chat, or a phone/WhatsApp number) runs as
 * the Merc user with that phone, and every call logs caller_source "demo_global". A present but invalid or expired claim
 * stays forbidden. Unset or empty = normal verification (REQ-BUD-002/013); it is unset on dev. Remove after the demo.
 */
export const NAME_DEMO_CALLER_PHONE = "MERC_DEMO_CALLER_PHONE";

export interface ToolSpec {
  /** Tool name (contracts/tools/merc-buddy/<name>.json). */
  tool: string;
  /** Backing function slug; the impl is the same one its Wonderful Function runs. */
  slug: string;
  /** Contract `inject` list, reduced to the fields the function request accepts. */
  inject: string[];
  /** Where the account id for customers.attach comes from (REQ-BUD-007), if this tool attaches memory. */
  attach?: "resolved" | "card" | "debrief";
}

export interface ApiErrorOut { error: { code: string; message: string; details?: Record<string, unknown> } }
type Ctx = any;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** "el" (default, REQ-CORE-012) or "en", from the live session locale. */
export function sessionLanguage(ctx: Ctx): "el" | "en" {
  let kv: unknown = null;
  try { kv = ctx?.kv?.get?.("language_locale"); } catch { kv = null; }
  const loc = str(kv) ?? str(ctx?.metadata?.communication?.locale) ?? str(ctx?.metadata?.agent?.language) ?? "el-GR";
  return loc.toLowerCase().startsWith("en") ? "en" : "el";
}

/** Device location the Rep App put in the session metadata (merc_lat/merc_lng or device_location{lat,lng}). */
export function deviceLocation(ctx: Ctx): { lat: number; lng: number } | null {
  const md = ctx?.metadata?.communication?.metadata ?? {};
  const dl = md.device_location && typeof md.device_location === "object" ? md.device_location : {};
  const lat = num(md.merc_lat ?? dl.lat), lng = num(md.merc_lng ?? dl.lng);
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** The request fields set by code for one tool call. `caller` is not a field: runAsTool reads it from the session. */
export function injectedFields(ctx: Ctx, inject: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of inject) {
    const name = raw.replace(/\?$/, "");
    if (name === "caller") continue;
    if (name.includes("=")) { const [k, v] = name.split("="); out[k] = v; continue; }
    if (name === "conversation_id") out.conversation_id = str(ctx?.metadata?.communication?.id) ?? str(ctx?.metadata?.contextId);
    else if (name === "language") out.language = sessionLanguage(ctx);
    else if (name === "device_location") { const loc = deviceLocation(ctx); if (loc) { out.lat = loc.lat; out.lng = loc.lng; } }
  }
  return out;
}

/** Model params minus undefined values and anything that looks like identity (defence in depth; core strips it too). */
export function modelParams(params: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!params || typeof params !== "object") return out;
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v === undefined || k === "caller" || k.startsWith("merc_")) continue;
    out[k] = v;
  }
  return out;
}

/** Account id to attach for customer memory, from the tool result. */
export function attachId(kind: ToolSpec["attach"], res: any): string | null {
  if (!kind || !res || typeof res !== "object" || "error" in res) return null;
  if (kind === "resolved") return res.status === "resolved" ? str(res.account?.id) : null;
  if (kind === "card") return str(res.account?.id);
  if (kind === "debrief") return str(res.result?.account?.id);
  return null;
}

/** Message @merc/core throws when a session has neither a signed claim nor a channel number. */
const NO_IDENTITY = "no signed Merc identity in this session";

/** The session with the demo caller's number as its channel number, when MERC_DEMO_CALLER_PHONE is set (see above). */
export function withDemoCaller(ctx: Ctx, key: string, now: number): { ctx: Ctx; demo: boolean } {
  let v: unknown = null;
  try { v = ctx?.globals?.get?.(NAME_DEMO_CALLER_PHONE); } catch { v = null; }
  const phone = str(v);
  if (!phone) return { ctx, demo: false };
  try { if (callerFromTool(ctx, key, now).kind !== "channel_number") return { ctx, demo: false }; } // signed claim kept
  catch (e) { if ((e as Error)?.message !== NO_IDENTITY) return { ctx, demo: false }; } // bad/expired claim stays forbidden
  const c = ctx?.metadata?.communication ?? {};
  const type = String(c.type ?? "").toLowerCase().includes("whatsapp") ? "whatsapp" : "voice";
  return { ctx: { ...ctx, metadata: { ...(ctx?.metadata ?? {}), communication: { ...c, type, direction: "inbound", fromNumber: phone } } }, demo: true };
}

/** Caller as logged (REQ-BUD-002): the app_user id from the claim, or the masked channel number on phone/WhatsApp. */
function callerLabel(src: { kind: string; appUserId?: string; number?: string }): string {
  if (src.appUserId) return src.appUserId;
  const n = String(src.number ?? "");
  return n ? `phone:${"*".repeat(Math.max(0, n.length - 4))}${n.slice(-4)}` : src.kind;
}

/** Error code of a tool result, top level or inside {result}. */
const errorCode = (res: unknown): string | null => {
  const r = res as any;
  if (r && typeof r === "object" && r.error) return String(r.error.code ?? "error");
  if (r?.result && typeof r.result === "object" && r.result.error) return String(r.result.error.code ?? "error");
  return null;
};

const fail = (code: string, message: string, details?: Record<string, unknown>): ApiErrorOut => ({ error: details ? { code, message, details } : { code, message } });

/** Run one buddy tool through its shared handler. Always returns the contract response or {error}. */
export async function runTool(ctx: Ctx, spec: ToolSpec, impl: AnyImpl | null, params: unknown, deps: { now?: () => number; log?: (line: string) => void } = {}): Promise<unknown> {
  const log = deps.log ?? ((line: string) => console.log(line));
  if (!impl) {
    log(JSON.stringify({ merc_tool: spec.tool, fn: spec.slug, outcome: "handler_missing" }));
    return fail("blocked_by_policy", `${spec.tool} is not available yet: the ${spec.slug} handler is not deployed`, { missing: `shared/handlers/src/${spec.slug}.ts` });
  }
  const key = secretString(ctx, NAME_INTERNAL_KEY);
  if (!key) {
    log(JSON.stringify({ merc_tool: spec.tool, fn: spec.slug, outcome: "blocked", missing: NAME_INTERNAL_KEY }));
    return fail("blocked_by_policy", `merc-buddy is blocked: secret ${NAME_INTERNAL_KEY} is not set in this workspace`, { missing: NAME_INTERNAL_KEY, kind: "secret" });
  }
  // Channel tools (call_me_back, send_debrief_confirmation, report_buddy_call_outcome) need this runtime's
  // context.api (outbound call, service account on the agent) and context.outbound (WhatsApp). Read them from the
  // original ctx before it is copied below.
  const make = (TOOL_FACTORIES as Record<string, ((d: unknown) => AnyImpl) | undefined> | undefined)?.[spec.slug];
  if (make && buddyDepsFrom) impl = make(buddyDepsFrom(ctx));
  const textChannel = isTextChannel(ctx); // before withDemoCaller, which rewrites communication.type
  const now = deps.now?.() ?? Date.now();
  const demo = withDemoCaller(ctx, key, now);
  ctx = demo.ctx;
  let caller: string, callerSource: string;
  try {
    const src = callerFromTool(ctx, key, now) as { kind: string; appUserId?: string; number?: string };
    caller = callerLabel(src);
    callerSource = demo.demo ? "demo_global" : src.kind === "app_user" ? "signed_session_claim" : src.kind;
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    log(JSON.stringify({ merc_tool: spec.tool, fn: spec.slug, caller: null, caller_source: "none", outcome: "forbidden", reason: msg }));
    return fail("forbidden", msg);
  }
  const req = { ...modelParams(params), ...injectedFields(ctx, spec.inject) };
  const t0 = Date.now();
  const tctx = { metadata: ctx?.metadata, tables: ctx?.tables, secrets: ctx?.secrets ?? null, globals: ctx?.globals ?? null, api: ctx?.api ?? null };
  // Tool logs land in the model's context. Hold handler logs back and print them only when the call failed.
  const held: unknown[][] = [];
  const realLog = console.log;
  if (!deps.log) console.log = (...a: unknown[]) => { held.push(a); };
  let res: unknown;
  try { res = await runAsTool(spec.slug, impl, tctx, req, key); } finally { console.log = realLog; }
  const code = errorCode(res) ?? "ok";
  if (code !== "ok") for (const a of held) realLog(...a);
  // REQ-BUD-002 evidence on EVERY call: caller is set by code from the verified session, never by the model. Kept to one
  // short line (no handler logs on success) so the model's context stays small.
  log(JSON.stringify({ merc_tool: spec.tool, caller, caller_source: callerSource, outcome: code, ms: Date.now() - t0, ...(deps.log || code !== "ok" ? { fn: spec.slug, injected: Object.keys(req).filter((k) => !(k in modelParams(params))) } : {}) }));
  const acct = attachId(spec.attach, res);
  if (acct && ctx?.customers?.attach) {
    try { await ctx.customers.attach(acct); if (deps.log) log(JSON.stringify({ merc_tool: spec.tool, memory_attached: acct })); }
    catch (e) { log(JSON.stringify({ merc_tool: spec.tool, memory_attach_failed: (e as Error)?.message ?? String(e) })); }
  }
  const shown = textChannel ? forTextChannel(spec.tool, res, sessionLanguage(ctx)) : res;
  return compactResult(spec.tool, shown, { text: textChannel });
}
