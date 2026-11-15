// merc-approver tool glue (WP-APV-01, REQ-APV-001/002, REQ-DSC-003/008).
// Every tool runs the SAME handler as its backing Function (runFunction from @merc/core in the Shared Library,
// impls bundled from shared/handlers/src into ./handlers.gen.js). Values in the tool contracts' `inject` lists
// come from code, never from the model:
//   call_metadata.approval_id / call_metadata.manager_call_id  -> resolveCall() from the live communication
//   callee                                                       -> the approval's own approver (app_user), as principal
//   via=phone_call, conversation_id                              -> constants / communication.id
import {
  createDb, forbidden, notFound, resolvePrincipal, runFunction,
  type Db, type FunctionSlug, type Impl, type Outcome, type Principal, type Row, type TablesApi, type UserPrincipal,
} from "../shared_lib/utils/merc_core/index";
import { makeApprovalDecide, makeApproverBrief, makeManagerCallOutcome } from "./handlers.gen.js";

/** What a merc-approver tool needs from the Wonderful tool context (structural, so tests can fake it). */
export interface ApproverCtx {
  tables: TablesApi;
  api?: { post: (path: string, opts?: { body?: unknown }) => Promise<unknown> } | null;
  secrets?: { get(name: string): unknown } | null;
  globals?: { get(name: string): unknown } | null;
  metadata?: {
    workspaceId?: string | null;
    communication?: {
      id?: string | null;
      toNumber?: string | null;
      fromNumber?: string | null;
      direction?: string | null;
      metadata?: Record<string, unknown> | null;
    } | null;
  } | null;
}

export interface ResolvedCall {
  call: Row<"manager_call">;
  approval: Row<"approval">;
  callee: Row<"app_user">;
  conversationId: string | null;
  /** How the call was matched (for logs / evidence). */
  via: "conversation_id" | "call_purpose" | "callee_phone";
}

export const CALL_PURPOSE_PREFIX = "merc_approval:";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PURPOSE_RE = new RegExp(`${CALL_PURPOSE_PREFIX}(${UUID})`, "i");
/** A phone call to the approver is only matched to a manager_call started this recently (phone fallback). */
export const PHONE_MATCH_WINDOW_MS = 15 * 60_000;
const OPEN: Row<"manager_call">["outcome"][] = ["queued", "ringing", "answered"];

const digits = (p: string | null | undefined) => (p ?? "").replace(/[^\d]/g, "");
/** Same E.164 number, tolerant of formatting ("+30 690..." vs "+30690..."). */
export const samePhone = (a: string | null | undefined, b: string | null | undefined) => digits(a).length >= 8 && digits(a) === digits(b);

/** `merc_approval:<uuid>` set by fn:discount-request as call_purpose, wherever the platform surfaces it in metadata. */
export function approvalIdFromMetadata(md: Record<string, unknown> | null | undefined): string | null {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): string | null => {
    if (typeof v === "string") return PURPOSE_RE.exec(v)?.[1]?.toLowerCase() ?? null;
    if (!v || typeof v !== "object" || depth > 3 || seen.has(v)) return null;
    seen.add(v);
    for (const x of Object.values(v as Record<string, unknown>)) { const id = walk(x, depth + 1); if (id) return id; }
    return null;
  };
  return walk(md ?? null, 0);
}

/**
 * Which approval is this call about? Matched server-side only (S7 §4), in order of strength:
 * 1. manager_call.wonderful_conversation_id == this communication id (stored by fn:discount-request from the outbound API),
 * 2. `merc_approval:<approval_id>` in the communication metadata (call_purpose),
 * 3. the newest open manager_call (last 15 min) whose callee's phone is this call's number.
 * Then the callee must be the approval's approver and, when the platform gives numbers, their phone must be on the call.
 * Inbound calls are refused: merc-approver only takes calls it placed.
 */
export async function resolveCall(ctx: ApproverCtx, now: number = Date.now()): Promise<ResolvedCall> {
  const comm = ctx.metadata?.communication ?? {};
  if (comm.direction && /inbound/i.test(comm.direction)) throw forbidden("merc-approver only handles the outbound approval calls it placed");
  const root = createDb(ctx.tables);
  const conversationId = comm.id ?? null;
  let call: Row<"manager_call"> | null = null;
  let via: ResolvedCall["via"] = "conversation_id";

  if (conversationId) call = await root.manager_call.findOne({ wonderful_conversation_id: conversationId });
  if (!call) {
    const approvalId = approvalIdFromMetadata(comm.metadata ?? null);
    if (approvalId) {
      via = "call_purpose";
      const calls = await root.manager_call.all({ approval_id: approvalId });
      call = calls.sort((a, b) => b.attempt_no - a.attempt_no)[0] ?? null;
    }
  }
  if (!call) {
    const number = comm.toNumber || comm.fromNumber;
    if (number) {
      via = "callee_phone";
      const open = (await root.manager_call.all({ outcome: OPEN })).filter((c) => now - Date.parse(c.started_at) <= PHONE_MATCH_WINDOW_MS);
      for (const c of open.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))) {
        const u = await root.app_user.get(c.callee_id);
        if (u && (samePhone(u.phone, comm.toNumber) || samePhone(u.phone, comm.fromNumber))) { call = c; break; }
      }
    }
  }
  if (!call) throw notFound("no Merc approval is linked to this call");

  const approval = await root.approval.require(call.approval_id);
  if (approval.approver_id !== call.callee_id) throw forbidden("the person on this call is not the approver of this request");
  const callee = await root.app_user.require(call.callee_id);
  const numbers = [comm.toNumber, comm.fromNumber].filter((n): n is string => !!n);
  if (numbers.length && !numbers.some((n) => samePhone(callee.phone, n))) throw forbidden("this call is not to the approver's phone");
  return { call, approval, callee, conversationId, via };
}

/** `inject: callee`: the approver, resolved exactly like an app user (role, team, permissions). */
export const calleePrincipal = (ctx: ApproverCtx, r: ResolvedCall): Promise<UserPrincipal> =>
  resolvePrincipal(ctx.tables, { kind: "app_user", appUserId: r.callee.id, orgId: r.callee.org_id });

type Deps = { api?: ApproverCtx["api"]; now?: () => number };
const depsOf = (ctx: ApproverCtx, now?: () => number): Deps => ({ api: ctx.api && typeof ctx.api.post === "function" ? ctx.api : null, ...(now ? { now } : {}) });
const platformOf = (ctx: ApproverCtx) => ({ secrets: ctx.secrets ?? null, globals: ctx.globals ?? null, workspaceId: ctx.metadata?.workspaceId ?? null });

/** Run a backing handler with the callee as principal (contract validation, gate, response check all in runFunction). */
async function run<S extends FunctionSlug>(slug: S, impl: Impl<S, any>, ctx: ApproverCtx, me: Principal, data: unknown): Promise<Outcome<S>> {
  return runFunction(slug, impl as Impl<S, Principal>, { tables: ctx.tables, data, principal: async () => me, platform: platformOf(ctx) });
}

export type ToolResult = Record<string, unknown>;
const errorOut = (e: unknown): ToolResult => {
  const err = (e as { code?: string; message?: string }) ?? {};
  return { error: { code: err.code ?? "upstream_failed", message: err.message ?? String(e) } };
};
const isErr = (o: unknown): o is { error: { code: string; message: string } } => !!o && typeof o === "object" && "error" in (o as object);

/** get_approval_brief -> fn:approver-brief. Also marks the call answered (a person is on the line), so the 90 s
 *  no-answer timeout cannot flip a live conversation to async. */
export async function getApprovalBrief(ctx: ApproverCtx, now?: () => number): Promise<ToolResult> {
  let r: ResolvedCall;
  try { r = await resolveCall(ctx, now?.()); } catch (e) { return errorOut(e); }
  const me = await calleePrincipal(ctx, r).catch((e) => e as Error);
  if (me instanceof Error) return errorOut(me);
  const brief = await run("approver-brief", makeApproverBrief(depsOf(ctx, now)), ctx, me, { approval_id: r.approval.id });
  if (isErr(brief)) return brief as ToolResult;
  if (r.call.outcome === "queued" || r.call.outcome === "ringing") {
    await run("manager-call-outcome", makeManagerCallOutcome(depsOf(ctx, now)), ctx, me, { manager_call_id: r.call.id, outcome: "answered", conversation_id: r.conversationId });
  }
  const decided = r.approval.status !== "pending" && r.approval.status !== "escalated";
  return { ...(brief as object), already_decided: decided, status: r.approval.status };
}

export interface DecisionParams { decision: "approve" | "counter" | "reject"; approved_pct?: number | null; note?: string | null }
/** record_approval_decision -> fn:approval-decide with approval_id, via=phone_call and the callee injected. */
export async function recordApprovalDecision(ctx: ApproverCtx, params: DecisionParams, now?: () => number): Promise<ToolResult> {
  let r: ResolvedCall;
  try { r = await resolveCall(ctx, now?.()); } catch (e) { return errorOut(e); }
  const me = await calleePrincipal(ctx, r).catch((e) => e as Error);
  if (me instanceof Error) return errorOut(me);
  const body: Record<string, unknown> = { decision: params.decision, approval_id: r.approval.id, via: "phone_call" };
  if (params.approved_pct != null) body.approved_pct = params.approved_pct;
  if (params.note != null && params.note !== "") body.note = params.note;
  return (await run("approval-decide", makeApprovalDecide(depsOf(ctx, now)), ctx, me, body)) as ToolResult;
}

export type CallOutcome = "no_answer" | "busy" | "voicemail" | "failed";
/** report_call_outcome -> fn:manager-call-outcome with manager_call_id and conversation_id injected. */
export async function reportCallOutcome(ctx: ApproverCtx, outcome: CallOutcome, now?: () => number): Promise<ToolResult> {
  let r: ResolvedCall;
  try { r = await resolveCall(ctx, now?.()); } catch (e) { return errorOut(e); }
  const me = await calleePrincipal(ctx, r).catch((e) => e as Error);
  if (me instanceof Error) return errorOut(me);
  const out = (await run("manager-call-outcome", makeManagerCallOutcome(depsOf(ctx, now)), ctx, me, { manager_call_id: r.call.id, outcome, conversation_id: r.conversationId })) as ToolResult;
  if (outcome !== "voicemail" || isErr(out)) return out;
  // REQ-DSC-008: hand the model the only safe words for a voicemail, built from rows (no %, no customer).
  const requester = await createDb(ctx.tables, r.callee.org_id).app_user.get(r.approval.requested_by);
  return { ...out, say: voicemailLine(r.callee.preferred_language === "en" ? "en" : "el", requester?.full_name ?? "") };
}

/** OnEnd: report `failed` only when the call ended with the approval still undecided (otherwise a no-op). */
export async function onCallEnded(ctx: ApproverCtx, now?: () => number): Promise<ToolResult> {
  let r: ResolvedCall;
  try { r = await resolveCall(ctx, now?.()); } catch (e) { return { skipped: true, reason: (e as Error).message }; }
  if (r.approval.status !== "pending" || r.approval.mode !== "live") return { skipped: true, reason: `approval is ${r.approval.mode}/${r.approval.status}` };
  return reportCallOutcome(ctx, "failed", now);
}

// ---- voicemail (REQ-DSC-008) -------------------------------------------------------------------------
/** The only words left on a voicemail: who is waiting, nothing commercial (no %, no customer, no product, no number). */
export function voicemailLine(lang: string, requesterName: string): string {
  const who = requesterName.replace(/[\d%€$]/g, "").replace(/\s+/g, " ").trim() || (lang === "en" ? "a colleague" : "συνάδελφο");
  return lang === "en"
    ? `Hello, this is Merc. There is an approval waiting for you from ${who} in the Merc app. Thank you.`
    : `Γεια σας, εδώ Merc. Σας περιμένει ένα αίτημα έγκρισης από ${who} στην εφαρμογή Merc. Ευχαριστώ.`;
}

/** OnVoicemailDetected: leave the safe line, report voicemail (-> async fallback), end the call. */
export async function onVoicemail(ctx: ApproverCtx & { agent?: { announce?: (m: string, p?: { interruptible?: boolean }) => unknown }; telephony?: { end?: (wait?: boolean) => unknown } }, now?: () => number): Promise<ToolResult> {
  let line = voicemailLine("el", "");
  let reported: ToolResult = { skipped: true };
  try {
    const r = await resolveCall(ctx, now?.());
    const db: Db = createDb(ctx.tables, r.callee.org_id);
    const requester = await db.app_user.get(r.approval.requested_by);
    const org = await db.organization.get(r.callee.org_id);
    const lang = r.callee.preferred_language || org?.default_language || "el";
    line = voicemailLine(lang === "en" ? "en" : "el", requester?.full_name ?? "");
    reported = await reportCallOutcome(ctx, "voicemail", now);
  } catch (e) {
    reported = errorOut(e);
  }
  try { await ctx.agent?.announce?.(line, { interruptible: false }); } catch { /* the call may already be gone */ }
  try { await ctx.telephony?.end?.(true); } catch { /* idem */ }
  return { voicemail_left: true, line, reported };
}
