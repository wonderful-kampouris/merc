// shared/live (@merc/live), REQ-CORE-011: the one way Merc code talks to fn:merc-live.
//   channelsFor(me)              -> the channels a connection joins (rep:{user_id}; managers also team:{user_id})
//   push(platform, type, payload, to) -> validates {type, at, payload} against contracts/events and posts it to
//                                   /v1/function-sockets/messages, once per target.
// A push is fire-and-forget (platform docs): it never throws into business code. Without a service account
// (`context.api` missing or "not configured") it is a no-op that logs why, so screens fall back to polling.
import { validateSchema, type Db, type Principal, type Schema } from "../../core/src/index";
import { events as EVENT_SCHEMAS } from "../../core/src/generated/contracts/schemas";
import type { EventPayloadMap, EventType, MercEvent } from "../../core/src/generated/contracts/types";

export type { EventPayloadMap, EventType, MercEvent };
export const PUSH_PATH = "/v1/function-sockets/messages";
export const EVENT_TYPES = Object.keys(EVENT_SCHEMAS).sort() as EventType[];

// ---- channels
export const repChannel = (userId: string) => `rep:${userId}`;
export const teamChannel = (managerUserId: string) => `team:${managerUserId}`;

/** Channels for one connection (contracts/functions/merc-live.json notes): rep:{id}, plus team:{id} for managers. */
export function channelsFor(me: Pick<Principal, "id" | "role" | "kind">): string[] {
  if (me.kind !== "user") return [];
  return me.role === "manager" ? [repChannel(me.id), teamChannel(me.id)] : [repChannel(me.id)];
}

/**
 * team:{manager} channels that should hear about `userId`: every active manager above them (direct and indirect),
 * matching UserPrincipal.team_user_ids (a manager's team includes indirect reports). Cycle-safe.
 */
export async function teamChannelsOf(db: Db, userId: string, maxDepth = 10): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>([userId]);
  let cur = await db.app_user.get(userId);
  for (let i = 0; cur && cur.manager_id && i < maxDepth; i++) {
    const mid: string = cur.manager_id;
    if (seen.has(mid)) break;
    seen.add(mid);
    const m = await db.app_user.get(mid);
    if (!m) break;
    if (m.role_code === "manager" && m.status === "active") out.push(teamChannel(m.id));
    cur = m;
  }
  return out;
}

// ---- events
export type Validation = { ok: true } | { ok: false; errors: string[] };

/** Validate a full merc-live frame `{type, at, payload}` against contracts/events/<type>.json. */
export function validateEvent(msg: unknown): Validation {
  const m = msg as { type?: unknown; at?: unknown; payload?: unknown } | null;
  if (!m || typeof m !== "object" || Array.isArray(m)) return { ok: false, errors: ["$ must be an object"] };
  if (typeof m.type !== "string" || !(m.type in EVENT_SCHEMAS)) return { ok: false, errors: [`$.type unknown event type ${String(m.type)}`] };
  const extra = Object.keys(m).filter((k) => k !== "type" && k !== "at" && k !== "payload");
  if (extra.length) return { ok: false, errors: [`$ unexpected keys ${extra.join(",")}`] };
  const at = validateSchema({ type: "string", format: "date-time" }, m.at);
  if (!at.ok) return { ok: false, errors: at.errors.map((e) => e.replace(/^\$/, "$.at")) };
  const p = validateSchema((EVENT_SCHEMAS[m.type] as { payload: Schema }).payload, m.payload);
  return p.ok ? { ok: true } : { ok: false, errors: p.errors.map((e) => e.replace(/^\$/, "$.payload")) };
}

/** Build the envelope. `at` is an ISO instant (UTC). */
export function buildEvent<T extends EventType>(type: T, payload: EventPayloadMap[T], now: () => number = Date.now): MercEvent<T> {
  return { type, at: new Date(now()).toISOString(), payload };
}

// ---- push
/** The slice of the runtime context push needs: context.api (present only with a service account) and console. */
export interface ApiLike { post(path: string, options?: { body?: unknown; query?: Record<string, unknown>; headers?: Record<string, string> }): Promise<unknown> }
export interface PushPlatform { api?: ApiLike | null }
export type Logger = (level: "info" | "warn" | "error", message: string, details?: Record<string, unknown>) => void;
export type Target = { channel: string } | { connection_id: string };
export type PushTo = string | Target | Array<string | Target>;

export type PushReason = "no_service_account" | "invalid_event" | "no_targets" | "upstream_failed";
export interface PushResult {
  /** True when every target was posted. */
  pushed: boolean;
  sent: number;
  failed: number;
  reason?: PushReason;
  errors?: string[];
  event?: MercEvent;
}
export interface PushOptions { now?: () => number; log?: Logger }

const defaultLog: Logger = (level, message, details) => {
  const line = `[merc-live] ${message}${details ? " " + JSON.stringify(details) : ""}`;
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
};
const CHANNEL_RE = /^(rep|team):[0-9a-f-]{36}$/i;
function targets(to: PushTo): Target[] {
  const list = Array.isArray(to) ? to : [to];
  const out: Target[] = [];
  const seen = new Set<string>();
  for (const t of list) {
    const tt: Target = typeof t === "string" ? { channel: t } : t;
    const key = "channel" in tt ? `c:${tt.channel}` : `x:${tt.connection_id}`;
    if (!seen.has(key)) { seen.add(key); out.push(tt); }
  }
  return out;
}
const notConfigured = (e: unknown) => /not configured|service account/i.test(String((e as { message?: unknown })?.message ?? e));
const statusOf = (e: unknown) => (e && typeof e === "object" && typeof (e as { status?: unknown }).status === "number" ? (e as { status: number }).status : null);

/**
 * Push one event to rep:/team: channels (or a connection id). Never throws.
 * Invalid events and malformed channel names are rejected before anything is sent.
 */
export async function push<T extends EventType>(platform: PushPlatform | null | undefined, type: T, payload: EventPayloadMap[T], to: PushTo, opts: PushOptions = {}): Promise<PushResult> {
  const log = opts.log ?? defaultLog;
  const event = buildEvent(type, payload, opts.now);
  const v = validateEvent(event);
  if (!v.ok) {
    log("error", `push ${type} rejected: event breaks contracts/events/${type}.json`, { errors: v.errors });
    return { pushed: false, sent: 0, failed: 0, reason: "invalid_event", errors: v.errors, event };
  }
  const list = targets(to);
  const bad = list.filter((t) => "channel" in t && !CHANNEL_RE.test(t.channel)).map((t) => `bad channel ${(t as { channel: string }).channel}`);
  if (bad.length) {
    log("error", `push ${type} rejected: channels must be rep:{uuid} or team:{uuid}`, { errors: bad });
    return { pushed: false, sent: 0, failed: 0, reason: "invalid_event", errors: bad, event };
  }
  if (!list.length) return { pushed: false, sent: 0, failed: 0, reason: "no_targets", event };
  const api = platform?.api;
  if (!api || typeof api.post !== "function") {
    log("warn", `push ${type} skipped: no service account on this function (context.api unavailable); clients poll instead`, { targets: list.length });
    return { pushed: false, sent: 0, failed: 0, reason: "no_service_account", event };
  }
  let sent = 0;
  const errors: string[] = [];
  for (const t of list) {
    try {
      await api.post(PUSH_PATH, { body: { ...t, data: event } });
      sent++;
    } catch (e) {
      if (notConfigured(e)) {
        log("warn", `push ${type} skipped: context.api is not configured (set a service account on this function); clients poll instead`);
        return { pushed: false, sent, failed: list.length - sent, reason: "no_service_account", event };
      }
      const status = statusOf(e);
      errors.push(`${"channel" in t ? t.channel : t.connection_id}: ${status ?? "error"} ${String((e as Error)?.message ?? e)}`.slice(0, 300));
    }
  }
  if (errors.length) log("error", `push ${type}: ${errors.length}/${list.length} targets failed`, { errors });
  return errors.length ? { pushed: false, sent, failed: errors.length, reason: "upstream_failed", errors, event } : { pushed: true, sent, failed: 0, event };
}

/** Convenience: push to a rep and to every manager team channel above them. */
export async function pushToRepAndTeams<T extends EventType>(platform: PushPlatform | null | undefined, db: Db, repUserId: string, type: T, payload: EventPayloadMap[T], opts: PushOptions = {}): Promise<PushResult> {
  return push(platform, type, payload, [repChannel(repUserId), ...(await teamChannelsOf(db, repUserId))], opts);
}
