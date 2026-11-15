import type { FunctionResponseMap } from "../../../contracts";

export type ChatToken = FunctionResponseMap["merc-chat-token"];
/** The token shape the Chat SDK `createChat({ token })` takes. */
export interface SdkToken {
  token: string;
  expiresAt: string;
  refresh: () => Promise<{ token: string; expiresAt: string }>;
}

export const TOKEN_FN = "merc-chat-token";

export type TokenSource =
  | { ok: true; fetch: () => Promise<ChatToken> }
  | { ok: false; reason: "not_listed" | "mock" };

/**
 * Where the signed Chat SDK user token comes from (REQ-BUD-002). fn:merc-chat-token is the only source; the
 * screen calls it only when app.json lists it for /rep/record, so an unlisted function degrades the widget to a
 * clear "not configured" state instead of breaking REQ-APP-001. Mock mode never opens a real voice session.
 */
export function tokenSource(params: {
  functions: readonly string[];
  mock: boolean;
  call: () => Promise<ChatToken>;
}): TokenSource {
  if (params.mock) return { ok: false, reason: "mock" };
  if (!params.functions.includes(TOKEN_FN)) return { ok: false, reason: "not_listed" };
  return { ok: true, fetch: params.call };
}

/** Refresh this long before expiry (the SDK also refreshes itself; this keeps our cached copy fresh). */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;

export const isFresh = (t: ChatToken | null, now: number = Date.now()): t is ChatToken =>
  !!t && Date.parse(t.expires_at) - REFRESH_SKEW_MS > now;

/** Adapt fn:merc-chat-token to the SDK token object (expires_at -> expiresAt, refresh re-calls the function). */
export function toSdkToken(first: ChatToken, fetch: () => Promise<ChatToken>): SdkToken {
  return {
    token: first.token,
    expiresAt: first.expires_at,
    refresh: async () => {
      const t = await fetch();
      return { token: t.token, expiresAt: t.expires_at };
    },
  };
}
