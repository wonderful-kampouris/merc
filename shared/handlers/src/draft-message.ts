// fn:draft-message (contracts/functions/draft-message.json, REQ-DEB-005, REQ-APR-001): draft a customer message in
// the rep's own style (LLM contract draft_message, profile merc-write) and store it as a pending customer_message
// approval with a preview. NEVER sends: sending happens only in approval-resolve after the rep approves.
// Internal: called by debrief-process / alert-act (user or system principal) as a library (draftMessage).
import {
  blocked, defineFunction, forbidden, inTeam, invalid, MercError, notFound, requireAccount,
  type Db, type Impl, type Principal,
} from "../../core/src/index";
import { callStructured, type ModelFactory } from "../../llm/src/index";
import { push, repChannel, type ApiLike } from "../../live/src/index";
import type { FunctionRequestMap, FunctionResponseMap } from "../../core/src/generated/contracts/types";
import { approvalCard } from "./approvals-list";

export const ACTION_FOR_CHANNEL = { email: "send_email", whatsapp: "send_whatsapp", viber: "send_viber" } as const;
const STYLE_SAMPLES = 3;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

export interface DraftDeps { model?: ModelFactory; api?: ApiLike | null; now?: () => number }
type Req = FunctionRequestMap["draft-message"];

export async function draftMessage(db: Db, me: Principal, req: Req, deps: DraftDeps = {}): Promise<FunctionResponseMap["draft-message"]> {
  const now = deps.now ?? Date.now;
  const rep = await db.app_user.get(req.on_behalf_of);
  if (!rep) throw notFound("rep not found", { on_behalf_of: req.on_behalf_of });
  if (rep.status !== "active") throw invalid("rep is not active");
  if (me.kind === "user" && me.id !== rep.id && !inTeam(me, rep.id)) throw forbidden("you cannot draft messages on behalf of this user");
  const account = await requireAccount(db, me, req.account_id);
  if (!(await db.channel.get(req.channel))) throw invalid(`unknown channel ${req.channel}`);

  const wantsEmail = req.channel === "email";
  const addr = (c: { email?: string | null; phone?: string | null }) => (wantsEmail ? c.email : c.phone)?.trim() || null;
  let contact = null;
  if (req.contact_id) {
    contact = await db.contact.get(req.contact_id);
    if (!contact || contact.account_id !== account.id) throw invalid("contact does not belong to this account");
  } else {
    const all = await db.contact.all({ account_id: account.id });
    contact = all.filter((c) => addr(c)).sort((x, y) => Number(y.is_decision_maker) - Number(x.is_decision_maker) || x.full_name.localeCompare(y.full_name))[0] ?? null;
  }
  const recipient = (contact && addr(contact)) || addr(account);
  if (!recipient) throw invalid(`no ${wantsEmail ? "email address" : "phone number"} for ${account.name}`, { account_id: account.id, channel: req.channel });

  // Autonomy: a customer message is always an approval (REQ-DEB-005); `never` forbids even drafting it.
  const actionType = ACTION_FOR_CHANNEL[req.channel];
  const perm = await db.ai_permission.findOne({ role_code: rep.role_code, action_type_code: actionType });
  const mode = perm?.mode ?? (await db.action_type.get(actionType))?.default_mode ?? "ask";
  if (mode === "never") throw blocked(`AI may not draft ${actionType} for role ${rep.role_code} (ai_permission never)`, { action_type: actionType });

  const samples = (await db.activity.list({ actor_user_id: rep.id, activity_type: ["email", "message"] }, { limit: 20, orderBy: [{ column: "occurred_at", direction: "desc" }] })).items
    .map((x) => x.body?.trim()).filter((b): b is string => !!b).slice(0, STYLE_SAMPLES).map((b) => clip(b, 800));
  const facts = [{ label: "intent", value: req.intent }, ...(req.context ? [{ label: "context", value: req.context }] : [])];
  const r = await callStructured("draft_message", {
    intent: req.intent, channel: req.channel, language: rep.preferred_language || me.org.default_language, rep_name: rep.full_name,
    rep_style_samples: samples, account_name: account.name, contact_name: contact?.full_name ?? null, facts,
  }, { model: deps.model });
  if (!r.ok) throw new MercError(r.error.code, r.error.message, (r.error.details as Record<string, unknown> | null | undefined) ?? null);
  const body = r.value.body.trim();
  if (!body) throw new MercError("upstream_failed", "draft_message returned an empty body");
  const subject = wantsEmail ? (r.value.subject?.trim() || null) : null;

  const expires = new Date(now() + me.org.approval_expiry_hours * 3_600_000).toISOString();
  const action = await db.ai_action.insert({
    on_behalf_of: rep.id, agent: "email", action_type_code: actionType, target_table: "message_approval", status: "suggested",
    reason: clip(req.intent, 500), voice_log_id: req.voice_log_id ?? null,
    payload_json: JSON.stringify({ account_id: account.id, contact_id: contact?.id ?? null, channel: req.channel, intent: req.intent }),
  } as never);
  let approvalId: string | null = null;
  try {
    const approval = await db.approval.insert({ ai_action_id: action.id, kind: "customer_message", requested_by: rep.id, approver_id: rep.id, mode: "async", status: "pending", expires_at: expires } as never);
    approvalId = approval.id;
    const msg = await db.message_approval.insert({ approval_id: approval.id, channel_code: req.channel, contact_id: contact?.id ?? null, recipient_address: recipient, subject, draft_body: body } as never);
    await db.ai_action.update(action.id, { target_id: msg.id });
  } catch (e) {
    // Keep the tables consistent: no half-created approval.
    if (approvalId) await db.approval.delete(approvalId).catch(() => undefined);
    await db.ai_action.delete(action.id).catch(() => undefined);
    throw e;
  }
  const card = await approvalCard(db, (await db.approval.get(approvalId))!);
  await push({ api: deps.api ?? null }, "approval.created", { approval: card }, repChannel(rep.id), { now });
  return { approval_id: approvalId, ai_action_id: action.id };
}

export function makeImpl(deps: DraftDeps = {}): Impl<"draft-message", Principal> {
  return async ({ req, db, me }) => draftMessage(db, me, req, deps);
}
export const impl = makeImpl();

type Ctx = Parameters<ReturnType<typeof defineFunction>>[0] & { api?: ApiLike };
export const handle = (context: Ctx) => defineFunction("draft-message", makeImpl({ api: context.api ?? null }))(context);
