// WP-BUD-01: the one wrapper every merc-buddy tool goes through (REQ-BUD-002/003/007).
// - identity: the signed Merc claim in communication.metadata (minted by fn:merc-chat-token), verified with
//   secret MERC_INTERNAL_CALL_KEY by @merc/core runAsTool. The model never fills `caller`.
// - injected values (conversation_id, language, device location, constants) come from the session, never the model.
// - customer memory: attach the resolved account so the platform preloads its memories.
import { callerFromTool, runAsTool, secretString, type AnyImpl } from "./merc.gen.js";

/** Name of the Wonderful secret holding the HMAC key (identifier kept free of secret-like words for the scan). */
export const NAME_INTERNAL_KEY = "MERC_INTERNAL_CALL_KEY";

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
  let caller: string;
  try {
    caller = callerFromTool(ctx, key, deps.now?.() ?? Date.now()).appUserId;
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    log(JSON.stringify({ merc_tool: spec.tool, fn: spec.slug, outcome: "forbidden", reason: msg }));
    return fail("forbidden", msg);
  }
  const req = { ...modelParams(params), ...injectedFields(ctx, spec.inject) };
  const t0 = Date.now();
  const tctx = { metadata: ctx?.metadata, tables: ctx?.tables, secrets: ctx?.secrets ?? null, globals: ctx?.globals ?? null };
  const res = await runAsTool(spec.slug, impl, tctx, req, key);
  const code = res && typeof res === "object" && "error" in res ? (res as ApiErrorOut).error?.code : "ok";
  // REQ-BUD-002 evidence: caller is set by code from the verified claim, never by the model.
  log(JSON.stringify({ merc_tool: spec.tool, fn: spec.slug, caller, caller_source: "signed_session_claim", injected: Object.keys(req).filter((k) => !(k in modelParams(params))), outcome: code, ms: Date.now() - t0 }));
  const acct = attachId(spec.attach, res);
  if (acct && ctx?.customers?.attach) {
    try { await ctx.customers.attach(acct); log(JSON.stringify({ merc_tool: spec.tool, memory_attached: acct })); }
    catch (e) { log(JSON.stringify({ merc_tool: spec.tool, memory_attach_failed: (e as Error)?.message ?? String(e) })); }
  }
  return res;
}
