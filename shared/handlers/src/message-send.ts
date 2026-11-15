// fn:message-send (contracts/functions/message-send.json, REQ-APR-002): send ONE approved customer message, in the
// requesting rep's own identity, through the per-user Gmail Integration Hub connection (spike S3 / OPEN-03).
// Library call made inside approval-resolve (sendApproved); also deployed as an internal Function.
//  - Idempotent on the approval: status `sent` returns the stored result without calling the provider again; a
//    concurrent second send sees the in-flight claim and gets `conflict`.
//  - System callers (cron/procedure) never send (no user identity, contracts README).
//  - No sender available (no context.integrations, connection missing, rep has not connected Gmail, channel without a
//    sender) -> the approval becomes `failed` with failure_reason naming what is missing; approving again retries.
import {
  assertNotSystem, conflict, defineFunction, forbidden, globalString, invalid, MercError, notFound, today,
  type Db, type Impl, type PlatformLike, type Principal,
} from "../../core/src/index";
import type { FunctionResponseMap } from "../../core/src/generated/contracts/types";
import { loadApproval, msOf, parseJson } from "./approvals-list";

/** Global variable naming the per-user Gmail connection (name, key or id). Default below. */
export const GLOBAL_GMAIL_CONNECTION = "MERC_GMAIL_CONNECTION";
export const DEFAULT_GMAIL_CONNECTION = "merc-gmail";
export const GMAIL_SEND = "google_workspace_gmail_message_send";
/** A claim older than this is treated as a crashed send and may be retried. */
export const CLAIM_TTL_MS = 120_000;
const CLAIM = "claim:";

export interface IntegrationsLike { call(connection: string, action: string, args: Record<string, unknown>): Promise<unknown> }
export interface SendDeps { integrations?: IntegrationsLike | null; now?: () => number; nonce?: () => string }
export type SendResult = FunctionResponseMap["message-send"];

/** Message id from the provider result ({id}, {messageId}, {result:{id}}, {data:{...}}), or null. */
export function messageIdOf(res: unknown, depth = 0): string | null {
  if (!res || typeof res !== "object" || depth > 3) return null;
  const r = res as Record<string, unknown>;
  for (const k of ["id", "messageId", "message_id"]) if (typeof r[k] === "string" && r[k]) return r[k] as string;
  for (const k of ["result", "data", "message", "output"]) { const v = messageIdOf(r[k], depth + 1); if (v) return v; }
  return null;
}
const errText = (e: unknown) => String((e as { message?: unknown })?.message ?? e).replace(/\s+/g, " ").trim().slice(0, 500);

export async function sendApproved(db: Db, me: Principal, platform: PlatformLike, deps: SendDeps, approvalId: string): Promise<SendResult> {
  assertNotSystem(me);
  const now = deps.now ?? Date.now;
  const a = await loadApproval(db, approvalId);
  if (a.kind !== "customer_message") throw invalid(`approval ${a.id} is a ${a.kind} approval, not a customer message`);
  if (me.id !== a.requested_by) throw forbidden("a customer message is sent only in the requesting rep's own identity");
  const m = await db.message_approval.findOne({ approval_id: a.id });
  if (!m) throw notFound("message for approval not found", { approval_id: a.id });
  if (a.status === "sent") return { status: "sent", external_message_id: m.external_message_id ?? null, failure_reason: null };
  if (a.status !== "approved" && a.status !== "failed") throw conflict(`approval is ${a.status}; only an approved message can be sent`, { status: a.status });

  // Claim the send so a concurrent second approve cannot send twice.
  if (m.external_message_id?.startsWith(CLAIM) && now() - msOf(m.updated_at) < CLAIM_TTL_MS) throw conflict("this message is being sent right now", { approval_id: a.id });
  const claim = `${CLAIM}${deps.nonce?.() ?? `${now()}-${Math.random().toString(36).slice(2, 10)}`}`;
  await db.message_approval.update(m.id, { external_message_id: claim });
  if ((await db.message_approval.get(m.id))?.external_message_id !== claim) throw conflict("this message is being sent right now", { approval_id: a.id });

  const fail = async (reason: string): Promise<SendResult> => {
    console.error(`[message-send] approval ${a.id} failed: ${reason}`);
    await db.message_approval.update(m.id, { external_message_id: null, failure_reason: reason });
    await db.approval.update(a.id, { status: "failed" });
    return { status: "failed", external_message_id: null, failure_reason: reason };
  };

  const body = m.final_body ?? m.draft_body;
  const rep = await db.app_user.get(a.requested_by);
  const subject = m.subject?.trim() || `Message from ${rep?.full_name ?? "your sales rep"}`;
  if (m.channel_code !== "email") return fail(`no sender for channel ${m.channel_code} yet: only email (Gmail) is wired`);
  const integrations = deps.integrations;
  if (!integrations || typeof integrations.call !== "function") return fail("blocked: context.integrations is not available in this runtime; the per-user Gmail connection cannot be called");
  const connection = globalString(platform, GLOBAL_GMAIL_CONNECTION) ?? DEFAULT_GMAIL_CONNECTION;

  let res: unknown;
  try {
    res = await integrations.call(connection, GMAIL_SEND, { to: [m.recipient_address], subject, body });
  } catch (e) {
    const t = errText(e);
    const hint = /connect your own account/i.test(t) ? "the rep has not connected their Gmail account yet" : /not allow-?listed/i.test(t) ? `action ${GMAIL_SEND} is not allow-listed on connection ${connection}` : /not found|unknown connection/i.test(t) ? `connection ${connection} does not exist` : "the Gmail send failed";
    return fail(`${hint}: ${t}`);
  }

  const sentAt = new Date(now()).toISOString();
  const externalId = messageIdOf(res) ?? `sent:${a.id}`;
  await db.message_approval.update(m.id, { external_message_id: externalId, sent_at: sentAt, failure_reason: null, final_body: body });
  await db.approval.update(a.id, { status: "sent" });
  // Bookkeeping after the send must not turn a delivered message into an error.
  try {
    const act = a.ai_action_id ? await db.ai_action.get(a.ai_action_id) : null;
    if (act) await db.ai_action.update(act.id, { status: "applied", applied_at: sentAt, after_snapshot_json: JSON.stringify({ message_approval_id: m.id, external_message_id: externalId, sent_at: sentAt }) });
    const accountId = (m.contact_id ? (await db.contact.get(m.contact_id))?.account_id : null) ?? parseJson(act?.payload_json).account_id;
    if (typeof accountId === "string") {
      await db.activity.insert({ account_id: accountId, actor_user_id: me.id, contact_id: m.contact_id ?? null, voice_log_id: act?.voice_log_id ?? null, activity_type: "email", source: "ai", body: `${subject}\n\n${body}`, occurred_at: sentAt } as never);
    }
    await db.usage_event.insert({ user_id: me.id, day: today(me.org, now()), kind: "emails_sent", quantity: 1 } as never);
  } catch (e) {
    console.error(`[message-send] approval ${a.id} sent, bookkeeping failed: ${errText(e)}`);
  }
  return { status: "sent", external_message_id: externalId, failure_reason: null };
}

export function makeImpl(deps: SendDeps): Impl<"message-send", Principal> {
  return async ({ req, db, me, platform }) => sendApproved(db, me, platform, deps, req.approval_id);
}
export const impl = makeImpl({});

/** Wonderful Function entry: the rep's own context.integrations (per-user Gmail resolves from metadata.user). */
export const handle = (context: Parameters<ReturnType<typeof defineFunction>>[0] & { integrations?: IntegrationsLike }) =>
  defineFunction("message-send", makeImpl({ integrations: context.integrations ?? null }))(context);

export { MercError };
