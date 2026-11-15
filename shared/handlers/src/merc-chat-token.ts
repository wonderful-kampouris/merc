// fn:merc-chat-token (contracts/functions/merc-chat-token.json, REQ-BUD-002 / OPEN-08).
// Mints a Chat SDK signed user token for the calling rep. Its metadata carries the HMAC-signed Merc identity
// (merc_uid, merc_org, merc_exp, merc_sig) that buddy tools verify with shared/core callerFromTool().
// Until the platform pieces exist it answers blocked_by_policy naming exactly what is missing.
import { blocked, defineFunction, globalString, MercError, secretString, signIdentity, type Impl, type PlatformLike } from "../../core/src/index";

export const NAME_CHAT_KEY = "MERC_CHAT_API_KEY";
export const NAME_INTERNAL_KEY = "MERC_INTERNAL_CALL_KEY";
/** Global variable holding the merc-buddy agent id of this workspace (set when merc-buddy is created). */
export const GLOBAL_BUDDY_AGENT_ID = "MERC_BUDDY_AGENT_ID";
/** Optional global variable overriding the platform API base URL. */
export const GLOBAL_API_URL = "MERC_PLATFORM_API_URL";
export const DEFAULT_API_URL = "https://default.api.greece-hackathon.sb.wonderful.ai";
export const SIGN_PATH = "/api/v1/jwt/sign";
export const TTL_SECONDS = 3600;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text?(): Promise<string> }>;
export interface ChatTokenDeps { fetch: FetchLike; now?: () => number }

const HOW: Record<string, string> = {
  [NAME_CHAT_KEY]: "create a workspace API key with Chat/Create + Communications/View and store it as secret MERC_CHAT_API_KEY (type Other or Bearer Token)",
  [NAME_INTERNAL_KEY]: "store a random 32+ byte value as secret MERC_INTERNAL_CALL_KEY (the buddy tools verify merc_sig with it)",
  [GLOBAL_BUDDY_AGENT_ID]: "set global variable MERC_BUDDY_AGENT_ID to the merc-buddy agent id once WP-BUD-01 creates the agent",
};
function missing(kind: "secret" | "global variable", name: string): MercError {
  return blocked(`merc-chat-token is blocked: ${kind} ${name} is not set in this workspace`, { missing: name, kind, how: HOW[name] ?? null });
}

/** Seconds or ms epoch, or a date string -> ISO 8601. */
export function toIso(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  if (typeof v === "string" && v.trim()) {
    if (/^\d+$/.test(v.trim())) return toIso(Number(v.trim()));
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

export function makeImpl(deps: ChatTokenDeps): Impl<"merc-chat-token"> {
  return async ({ me, platform }: { me: Parameters<Impl<"merc-chat-token">>[0]["me"]; platform: PlatformLike }) => {
    const apiKey = secretString(platform, NAME_CHAT_KEY);
    if (!apiKey) throw missing("secret", NAME_CHAT_KEY);
    const internalKey = secretString(platform, NAME_INTERNAL_KEY);
    if (!internalKey) throw missing("secret", NAME_INTERNAL_KEY);
    const agentId = globalString(platform, GLOBAL_BUDDY_AGENT_ID);
    if (!agentId) throw missing("global variable", GLOBAL_BUDDY_AGENT_ID);
    const baseUrl = (globalString(platform, GLOBAL_API_URL) ?? DEFAULT_API_URL).replace(/\/+$/, "");

    const now = deps.now?.() ?? Date.now();
    const claims = signIdentity(internalKey, { app_user_id: me.id, org_id: me.org_id, ttlSeconds: TTL_SECONDS, now });
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
    if (platform.workspaceId) headers["X-Workspace-Id"] = platform.workspaceId;
    const body = JSON.stringify({ user: { id: me.id, display_name: me.user.full_name }, metadata: claims, expiresIn: TTL_SECONDS });

    let res: Awaited<ReturnType<FetchLike>>;
    try { res = await deps.fetch(`${baseUrl}${SIGN_PATH}`, { method: "POST", headers, body }); }
    catch (e) { throw new MercError("upstream_failed", `token mint request failed: ${(e as Error)?.message ?? e}`); }
    let json: any = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok) {
      const msg = typeof json?.error === "string" ? json.error : typeof json?.message === "string" ? json.message : `status ${res.status}`;
      throw new MercError("upstream_failed", `token mint rejected (${res.status}): ${msg}`, { status: res.status });
    }
    const data = json && typeof json === "object" && "data" in json && "status" in json ? json.data : json;
    const token = typeof data?.jwt === "string" ? data.jwt : typeof data?.token === "string" ? data.token : null;
    const expiresAt = toIso(data?.expiresAt ?? data?.expires_at) ?? new Date(Number(claims.merc_exp) * 1000).toISOString();
    if (!token) throw new MercError("upstream_failed", "token mint response has no token");
    return { token, expires_at: expiresAt, agent_id: agentId };
  };
}

/** Wonderful Function entry (functions/merc-chat-token/index.ts calls this), with the runtime's fetch. */
export const handle = defineFunction("merc-chat-token", makeImpl({ fetch: (url, init) => (globalThis as any).fetch(url, init) }));
