// fn:merc-live (contracts/functions/merc-live.json, REQ-CORE-011): the WebSocket the Rep and Mgmt apps hold open.
// connect   -> resolve the caller (REQ-CORE-002) and join rep:{user_id}, plus team:{user_id} for managers.
//              Unknown/inactive callers are refused with {ok:false, reason}; the app then polls.
// message   -> only {type:"ping"} is understood (answers {type:"pong", at}); clients never publish events.
// disconnect-> nothing to clean up (channels die with the socket).
// Events are pushed by other functions through shared/live push(); this function never pushes.
import { runFunction, principalFromFunction, type FunctionContext, type Impl, type Outcome } from "../../core/src/index";
import { channelsFor } from "../../live/src/index";

export const impl: Impl<"merc-live"> = async ({ me }) => ({ channels: channelsFor(me) });

/** Platform SocketEvent (docs build/functions#websocket-functions). */
export type SocketEvent =
  | { type: "connect"; connectionId: string; headers?: Record<string, string>; query?: Record<string, unknown> }
  | { type: "message"; connectionId: string; data: unknown }
  | { type: "disconnect"; connectionId: string; code?: number };

/** Only the contract's connect_query keys are taken from the URL (stray params like cache busters are dropped). */
export function connectRequest(query: Record<string, unknown> | undefined): { connect_query: Record<string, unknown> } {
  const q = query ?? {};
  const client = Array.isArray(q.client) ? q.client[0] : q.client;
  return { connect_query: client === undefined ? {} : { client } };
}

/** The connect step through the shared runner: request validation, identity, gate (null), response validation. */
export function connect(context: FunctionContext, query: Record<string, unknown> | undefined): Promise<Outcome<"merc-live">> {
  return runFunction("merc-live", impl, { tables: context.tables, data: connectRequest(query), principal: () => principalFromFunction(context.tables, context) });
}

type KvLike = { set(k: string, v: unknown): unknown };
/**
 * Normalize what the runner passes. Real socket events carry a connectionId; the editor's draft Run passes the
 * run params as the event itself (seen on dev: event = {type:"ping"}), so an event without a connectionId is
 * treated as one client frame. Connect/disconnect always carry a connectionId, so this never opens a connection.
 */
export function normalizeEvent(event: unknown): SocketEvent | null {
  if (!event || typeof event !== "object") return null;
  const e = event as { connectionId?: unknown };
  if (typeof e.connectionId === "string" && e.connectionId) return event as SocketEvent;
  return { type: "message", connectionId: "draft-run", data: event };
}

export async function main(context: FunctionContext & { kv?: KvLike }, raw: SocketEvent | unknown): Promise<unknown> {
  const event = normalizeEvent(raw);
  switch (event?.type) {
    case "connect": {
      const out = await connect(context, event.query);
      if ("error" in out) return { ok: false, reason: `${out.error.code}: ${out.error.message}` };
      try { context.kv?.set("channels", out.channels); } catch { /* kv is optional */ }
      return { ok: true, channels: out.channels };
    }
    case "message": {
      const d = event.data as { type?: unknown } | null;
      if (d && typeof d === "object" && d.type === "ping") return { type: "pong", at: new Date().toISOString() };
      return { error: { code: "validation_failed", message: "merc-live accepts only {\"type\":\"ping\"} frames; events are server-pushed" } };
    }
    case "disconnect":
      return {};
    default:
      return { error: { code: "validation_failed", message: "unknown socket event" } };
  }
}

/** Alias so a runner that calls userFunction(context, event) reaches the same code. */
export const handle = main;
