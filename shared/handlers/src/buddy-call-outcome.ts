// fn:buddy-call-outcome (contracts/functions/buddy-call-outcome.json, REQ-BUD-015). How an outbound buddy call
// ended. merc-buddy's trigger tools report it (OnVoicemailDetected -> voicemail, OnEnd before the rep spoke ->
// no_answer, OnAfterFirstUserMessage -> answered); buddy-callbacks-due times out calls nobody reported.
// Not answered -> exactly ONE fallback: a WhatsApp template ping (merc_buddy_ping) when the rep has WhatsApp, else
// push + inbox (an open task). Never a call retry.
import { isAdmin,
  createDb, forbidden, notFound, principalFromTool, runFunction,
  type Db, type Impl, type PlatformLike, type Principal, type Row, type ToolContext, type UserPrincipal,
} from "../../core/src/index";
import { push, repChannel } from "../../live/src/index";
import {
  CALL_PURPOSE_PREFIX, defineWithDeps, depsFrom, hasWhatsApp, isoAt, logOf, nowOf, startNow, type BuddyDeps,
} from "./buddy-call-start";

type Outcome = "answered" | "no_answer" | "busy" | "voicemail" | "failed";
type Fallback = "none" | "whatsapp" | "app";
const NOT_ANSWERED: Outcome[] = ["no_answer", "busy", "voicemail"];
/** A started call with no reported outcome after this long counts as no_answer (lazy timeout, spike S7). */
export const NO_ANSWER_AFTER_MS = 3 * 60_000;

/** Fallback for a call the rep did not take. Idempotent: the fallback row/task is keyed on the call id. */
export async function fallbackFor(db: Db, platform: PlatformLike, deps: BuddyDeps, call: Row<"buddy_call">, user: Row<"app_user">, org: Row<"organization">): Promise<Fallback> {
  const refKey = { ref_table: "buddy_call", ref_id: call.id };
  if (hasWhatsApp(user, platform)) {
    const prior = (await db.buddy_call.all({ user_id: user.id, ...refKey })).find((r) => r.channel === "whatsapp");
    if (prior) return "whatsapp";
    const ping = await db.buddy_call.insert({
      user_id: user.id, channel: "whatsapp", purpose: call.purpose, reason: call.reason ?? null, due_at: isoAt(nowOf(deps)),
      ...refKey, status: "scheduled",
    });
    const sent = await startNow(db, platform, deps, ping, user, org);
    if (sent.status === "sent") return "whatsapp";
    logOf(deps)("warn", `buddy_call ${call.id}: WhatsApp fallback failed (${sent.row.failure_reason}); using the app`);
  }
  const title = (user.preferred_language || org.default_language) === "en"
    ? `Merc tried to call you: ${call.reason ?? call.purpose}`
    : `Το Merc προσπάθησε να σε καλέσει: ${call.reason ?? call.purpose}`;
  const existing = await db.task.findOne({ owner_id: user.id, title, status: "open" });
  if (!existing) await db.task.insert({ owner_id: user.id, title: title.slice(0, 240), is_customer_promise: false, due_at: isoAt(nowOf(deps)), status: "open", source: "ai" });
  await push(deps, "buddy_call.status", { buddy_call_id: call.id, channel: call.channel, status: call.status }, repChannel(user.id), { now: deps.now, log: logOf(deps) });
  return "app";
}

/** Record one outcome on a buddy_call and run the fallback once. */
export async function applyOutcome(db: Db, platform: PlatformLike, deps: BuddyDeps, call: Row<"buddy_call">, outcome: Outcome, conversationId: string | null = null): Promise<Fallback> {
  const user = await db.app_user.require(call.user_id);
  const org = await createDb(db.api, user.org_id).organization.require(user.org_id);
  // Only a call that is still open (started) changes; repeated or late reports are no-ops (no second ping).
  if (call.status !== "started") return "none";
  const updated = await db.buddy_call.update(call.id, {
    status: outcome, ...(outcome !== "answered" ? { ended_at: isoAt(nowOf(deps)) } : {}),
    ...(conversationId && !call.wonderful_conversation_id ? { wonderful_conversation_id: conversationId } : {}),
  });
  await push(deps, "buddy_call.status", { buddy_call_id: call.id, channel: call.channel, status: outcome }, repChannel(user.id), { now: deps.now, log: logOf(deps) });
  if (call.channel !== "call" || !NOT_ANSWERED.includes(outcome)) return "none";
  return fallbackFor(db, platform, deps, updated, user, org);
}

/** Lazy no-answer: started calls with no outcome after NO_ANSWER_AFTER_MS (called by buddy-callbacks-due). */
export async function timeoutStaleCalls(db: Db, platform: PlatformLike, deps: BuddyDeps, opts: { dryRun?: boolean } = {}): Promise<string[]> {
  const cutoff = nowOf(deps) - NO_ANSWER_AFTER_MS;
  const stale = (await db.buddy_call.all({ status: "started", channel: "call" })).filter((c) => c.started_at && Date.parse(c.started_at) <= cutoff);
  const out: string[] = [];
  for (const c of stale) {
    if (!(await db.app_user.get(c.user_id))) continue; // another org
    out.push(c.id);
    if (!opts.dryRun) await applyOutcome(db, platform, deps, c, "no_answer");
  }
  return out;
}

export function makeImpl(deps: BuddyDeps = {}): Impl<"buddy-call-outcome", Principal> {
  return async ({ req, db, me, platform }) => {
    const call = await db.buddy_call.get(req.buddy_call_id);
    const owner = call ? await db.app_user.get(call.user_id) : null; // org-scoped: null for another org
    if (!call || !owner) throw notFound("buddy_call not found", { buddy_call_id: req.buddy_call_id });
    if (me.kind === "user" && me.id !== call.user_id && !isAdmin(me)) throw forbidden("this buddy call belongs to another user");
    const fallback = await applyOutcome(db, platform, deps, call, req.outcome, req.conversation_id ?? null);
    return { buddy_call_id: call.id, fallback };
  };
}
export const impl = makeImpl() as Impl<"buddy-call-outcome", UserPrincipal>;
export const handle = defineWithDeps("buddy-call-outcome", makeImpl);

// ---- merc-buddy trigger tools ----------------------------------------------------------------------------------
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PURPOSE_RE = new RegExp(`${CALL_PURPOSE_PREFIX}(${UUID})`, "i");
/** `merc_buddy:<uuid>:<purpose>` (the call_purpose buddy-call-start sets), wherever the platform puts it. */
export function buddyCallIdFrom(v: unknown, depth = 0): string | null {
  if (typeof v === "string") return PURPOSE_RE.exec(v)?.[1]?.toLowerCase() ?? null;
  if (!v || typeof v !== "object" || depth > 4) return null;
  for (const x of Object.values(v as Record<string, unknown>)) { const id = buddyCallIdFrom(x, depth + 1); if (id) return id; }
  return null;
}

type SessionCtx = ToolContext & { api?: unknown; outbound?: unknown };
/** Which buddy_call is this session? By conversation id, then call_purpose; must belong to the session's rep. */
export async function resolveSessionCall(ctx: SessionCtx, me: UserPrincipal, now: number = Date.now()): Promise<Row<"buddy_call"> | null> {
  const db = createDb(ctx.tables, me.org_id);
  const comm = ctx.metadata?.communication as (Record<string, unknown> & { id?: string | null }) | null | undefined;
  if (String(comm?.direction ?? "").toLowerCase() === "inbound") return null;
  let call: Row<"buddy_call"> | null = null;
  if (comm?.id) call = await db.buddy_call.findOne({ wonderful_conversation_id: comm.id });
  if (!call) { const id = buddyCallIdFrom(comm ?? null); if (id) call = await db.buddy_call.get(id); }
  // The outbound API does not always hand back the conversation id, and call_purpose is not in the session
  // metadata: fall back to this rep's newest call-channel row that started in the last few minutes.
  if (!call && String(comm?.direction ?? "").toLowerCase() === "outbound") {
    call = (await db.buddy_call.all({ user_id: me.id, channel: "call" }))
      .filter((c) => c.started_at && now - Date.parse(c.started_at) >= 0 && now - Date.parse(c.started_at) < SESSION_MATCH_MS)
      .filter((c) => c.status === "started" || (c.status === "answered" && !c.ended_at))
      .sort((a, b) => Date.parse(b.started_at!) - Date.parse(a.started_at!))[0] ?? null;
  }
  return call && call.user_id === me.id && call.channel === "call" ? call : null;
}
/** How long after the outbound POST the call's session may still claim the row (ring + answer). */
export const SESSION_MATCH_MS = 5 * 60_000;

/**
 * OnStart on a merc-buddy voice session. An outbound buddy call: mark it answered (the rep picked up, the
 * agent is about to speak), store the conversation id, and return why we called so the agent opens with it.
 * Anything else (inbound call, chat): {kind:"inbound"}.
 */
export async function openCallFromSession(ctx: SessionCtx, key: string, extra: BuddyDeps = {}): Promise<
  | { kind: "inbound" }
  | { kind: "buddy_call"; buddy_call_id: string; purpose: Row<"buddy_call">["purpose"]; reason: string | null; first_name: string | null }
> {
  const comm = ctx.metadata?.communication as { id?: string | null; direction?: string | null } | null | undefined;
  if (String(comm?.direction ?? "").toLowerCase() !== "outbound") return { kind: "inbound" };
  let me: UserPrincipal;
  try { me = await principalFromTool(ctx.tables, ctx, key); } catch { return { kind: "inbound" }; }
  const call = await resolveSessionCall(ctx, me, nowOf(extra));
  if (!call) return { kind: "inbound" };
  if (call.status === "started") await reportFromSession(ctx, "answered", key, extra);
  const user = await createDb(ctx.tables, me.org_id).app_user.get(me.id);
  const first = String(user?.full_name ?? "").trim().split(/\s+/)[0] || null;
  return { kind: "buddy_call", buddy_call_id: call.id, purpose: call.purpose, reason: call.reason ?? null, first_name: first };
}

/**
 * OnEnd on a merc-buddy voice session: an answered buddy call gets its ended_at (the call is over); a call that
 * is still started was never answered and reports no_answer (one fallback).
 */
export async function closeCallFromSession(ctx: SessionCtx, key: string, extra: BuddyDeps = {}): Promise<Record<string, unknown>> {
  let me: UserPrincipal;
  try { me = await principalFromTool(ctx.tables, ctx, key); } catch (e) { return { skipped: true, reason: (e as Error).message }; }
  const call = await resolveSessionCall(ctx, me, nowOf(extra));
  if (!call) return { skipped: true, reason: "not an outbound merc-buddy call" };
  if (call.status === "started") return reportFromSession(ctx, "no_answer", key, extra);
  if (call.status === "answered" && !call.ended_at) {
    const comm = ctx.metadata?.communication as { id?: string | null } | null | undefined;
    await createDb(ctx.tables, me.org_id).buddy_call.update(call.id, {
      ended_at: isoAt(nowOf(extra)),
      ...(comm?.id && !call.wonderful_conversation_id ? { wonderful_conversation_id: comm.id } : {}),
    });
    return { buddy_call_id: call.id, status: "answered", ended: true };
  }
  return { skipped: true, reason: `buddy_call is already ${call.status}`, buddy_call_id: call.id };
}

/**
 * Trigger-tool entry: identity from the session (phone: the platform toNumber, REQ-BUD-013), the buddy_call from
 * the session, conversation_id injected. Returns {skipped} when this session is not an outbound buddy call.
 * `onlyIfOpen`: OnEnd reports no_answer only for a call still `started` (never answered).
 */
export async function reportFromSession(ctx: SessionCtx, outcome: Outcome, key: string, extra: BuddyDeps = {}): Promise<Record<string, unknown>> {
  let me: UserPrincipal;
  try { me = await principalFromTool(ctx.tables, ctx, key); } catch (e) { return { skipped: true, reason: (e as Error).message }; }
  const call = await resolveSessionCall(ctx, me, nowOf(extra));
  if (!call) return { skipped: true, reason: "not an outbound merc-buddy call" };
  if (call.status !== "started") return { skipped: true, reason: `buddy_call is already ${call.status}`, buddy_call_id: call.id };
  const comm = ctx.metadata?.communication as { id?: string | null } | null | undefined;
  const out = await runFunction("buddy-call-outcome", makeImpl(depsFrom(ctx, extra)), {
    tables: ctx.tables, data: { buddy_call_id: call.id, outcome, conversation_id: comm?.id ?? null }, principal: async () => me,
    platform: { secrets: ctx.secrets ?? null, globals: ctx.globals ?? null, workspaceId: null },
  });
  return out as Record<string, unknown>;
}

/** The model-facing report_buddy_call_outcome tool: buddy_call_id + outcome from params, conversation_id injected. */
export function reportOutcomeTool(ctx: SessionCtx, params: unknown, key: string, extra: BuddyDeps = {}) {
  const p = { ...((params as Record<string, unknown>) ?? {}) };
  const comm = ctx.metadata?.communication as { id?: string | null } | null | undefined;
  p.conversation_id = comm?.id ?? null;
  return principalFromTool(ctx.tables, ctx, key).then(
    (me) => runFunction("buddy-call-outcome", makeImpl(depsFrom(ctx, extra)), { tables: ctx.tables, data: p, principal: async () => me, platform: { secrets: ctx.secrets ?? null, globals: ctx.globals ?? null, workspaceId: null } }),
    (e) => ({ error: { code: "forbidden", message: (e as Error).message } }),
  );
}
