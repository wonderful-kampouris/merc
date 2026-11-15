import type { SdkToken } from "./token";

/** Chat SDK CDN build (spike S2: the npm package needs a registry login; the CDN works inside the App). */
export const CHAT_SDK_SRC = "https://cdn.wonderful.ai/chat-sdk/latest/chat-sdk.min.js";
export const DEFAULT_API_BASE = "https://default.api.greece-hackathon.sb.wonderful.ai";

export interface ChatHandle {
  setState(s: { open?: boolean }): void;
  destroy?: () => void;
  connection?: { status?: () => string; error?: () => unknown };
  voice?: { getState?: () => { status?: string; muted?: boolean } };
}
interface ChatSdk {
  createChat(cfg: Record<string, unknown>, host?: HTMLElement): ChatHandle;
  preload?(cfg: Record<string, unknown>): Promise<unknown>;
}

/** Chat SDK config for the buddy in voice mode, authenticated with the signed user token (no SDK key needed). */
export function buddyConfig(p: { token: SdkToken; agentId: string; baseUrl?: string; lang: "el" | "en"; title: string }): Record<string, unknown> {
  return {
    token: p.token,
    agentId: p.agentId,
    baseUrl: apiBase(p.baseUrl),
    modalities: ["voice"],
    title: p.title,
    locale: p.lang,
  };
}

/** The Chat API host: the app context's apiBaseUrl when it is absolute, else the hackathon default. */
export function apiBase(fromContext?: string | null): string {
  if (fromContext && /^https:\/\//.test(fromContext)) return fromContext.replace(/\/+$/, "").replace(/\/api(\/v\d+)?$/, "");
  return DEFAULT_API_BASE;
}

let loading: Promise<ChatSdk> | null = null;

/** Load the CDN build once; resolves the global `wonderful` SDK. */
export function loadChatSdk(doc: Document = document): Promise<ChatSdk> {
  const w = globalThis as unknown as { wonderful?: ChatSdk };
  if (w.wonderful?.createChat) return Promise.resolve(w.wonderful);
  if (loading) return loading;
  loading = new Promise<ChatSdk>((resolve, reject) => {
    const el = doc.createElement("script");
    el.src = CHAT_SDK_SRC;
    el.async = true;
    el.onload = () => (w.wonderful?.createChat ? resolve(w.wonderful) : reject(new Error("Chat SDK loaded without createChat")));
    el.onerror = () => reject(new Error("Chat SDK script failed to load"));
    doc.head.appendChild(el);
  }).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/**
 * Open the buddy. The handle should be kept for the page's life: route changes inside the app keep the call,
 * a reload ends it (spike S2).
 */
export async function openBuddy(cfg: Record<string, unknown>, host: HTMLElement): Promise<ChatHandle> {
  const sdk = await loadChatSdk(host.ownerDocument);
  await sdk.preload?.(cfg).catch(() => undefined);
  const chat = sdk.createChat(cfg, host);
  chat.setState({ open: true });
  return chat;
}
