// fn:approval-decide (contracts/functions/approval-decide.json): REQ-DSC-003/004/005/009.
// approve | counter (approved_pct < requested_pct and <= the approver's own limit) | reject.
// Then: requester follow-up task, approval.decided push (rep + team channels) and, when the request came from a
// live buddy conversation, an external event into it (spike S8 option B). SMS is not available (no sender).
import {
  assertApprover, blocked, conflict, forbidden, hmacSha256Hex, invalid, safeEqual, secretString,
  type Impl, type UserPrincipal,
} from "../../core/src/index";
import { pushToRepAndTeams } from "../../live/src/index";
import { defineWithApi, firstName, isoAt, nowOf, pct, resolveLimit, type DiscountDeps } from "./discount-check";
import { approvalCard, logOf, requireApproval } from "./discount-request";

export const NAME_LINK_KEY = "MERC_LINK_SIGNING_KEY";
export const EXTERNAL_EVENT_PATH = (communicationId: string) => `/v1/communications/${encodeURIComponent(communicationId)}/external-events`;
/** Token for a one-tap SMS link: HMAC-SHA256(key, "approval_id|approver_id"). */
export const linkToken = (key: string, approvalId: string, approverId: string) => hmacSha256Hex(key, `${approvalId}|${approverId}`);

export function makeImpl(deps: DiscountDeps = {}): Impl<"approval-decide", UserPrincipal> {
  return async ({ req, db, me, platform }) => {
    const a = await requireApproval(db, req.approval_id);
    if (a.kind !== "discount") throw invalid("approval-decide handles discount approvals only", { kind: a.kind });
    assertApprover(me, a);
    if (req.via === "sms_link") {
      const key = secretString(platform, NAME_LINK_KEY);
      if (!key) throw blocked(`approval-decide is blocked for sms_link: secret ${NAME_LINK_KEY} is not set`, { missing: NAME_LINK_KEY, kind: "secret", how: "store a random 32+ byte value as secret MERC_LINK_SIGNING_KEY" });
      if (!req.link_token || !safeEqual(linkToken(key, a.id, a.approver_id), req.link_token.toLowerCase())) throw forbidden("invalid approval link");
    }
    if (a.status !== "pending" && a.status !== "escalated") throw conflict(`approval is already ${a.status}`, { status: a.status });
    const dr = await db.discount_request.findOne({ approval_id: a.id });
    if (!dr) throw invalid("approval has no discount request", { approval_id: a.id });
    const account = await db.account.require(dr.account_id);
    const lines = await db.discount_request_line.all({ discount_request_id: dr.id });
    const now = nowOf(deps);
    const own = (await resolveLimit(db, me.org, me.user, account, lines.map((l) => l.product_id), now)).limit_pct;

    let approved: number | null = null;
    if (req.decision === "approve") {
      if (req.approved_pct != null && req.approved_pct !== dr.requested_pct) throw invalid("approve takes the requested %; use counter for another %", { requested_pct: dr.requested_pct });
      if (dr.requested_pct > own) throw invalid(`${pct(dr.requested_pct)} is above your own limit of ${pct(own)}; counter at most ${pct(own)}`, { approver_limit_pct: own });
      approved = dr.requested_pct;
    } else if (req.decision === "counter") {
      const c = req.approved_pct;
      if (c == null || !Number.isFinite(c) || c <= 0) throw invalid("counter needs approved_pct above 0");
      if (c >= dr.requested_pct) throw invalid(`a counter-offer must be below the requested ${pct(dr.requested_pct)}`, { requested_pct: dr.requested_pct, approved_pct: c });
      if (c > own) throw invalid(`a counter-offer must be within your own limit of ${pct(own)}`, { approver_limit_pct: own, approved_pct: c });
      approved = c;
    } else if (req.approved_pct != null) throw invalid("reject takes no approved_pct");

    const status = req.decision === "approve" ? "approved" : req.decision === "counter" ? "countered" : "rejected";
    const decided = await db.approval.update(a.id, { status, decided_by: me.id, decided_at: isoAt(now), decision_note: req.note ?? null, decided_via: req.via });
    const drNext = await db.discount_request.update(dr.id, { approved_pct: approved });
    if (req.via === "phone_call") {
      const live = (await db.manager_call.all({ approval_id: a.id, outcome: ["queued", "ringing"] }))[0];
      if (live) await db.manager_call.update(live.id, { outcome: "answered" });
    }

    // Requester tasks: close the "Waiting for ..." task, add the follow-up.
    const tail = `${pct(dr.requested_pct)} discount for ${account.name}`;
    for (const t of await db.task.all({ owner_id: a.requested_by, account_id: account.id, status: "open", source: "ai" })) {
      if (t.title.startsWith("Waiting for ") && t.title.endsWith(tail)) await db.task.update(t.id, { status: "done" });
    }
    const who = firstName(me.user);
    const title = status === "rejected" ? `Tell ${account.name}: ${who} rejected the ${pct(dr.requested_pct)} discount` : `Tell ${account.name}: ${who} ${status === "approved" ? "approved" : "offered"} ${pct(approved!)}`;
    await db.task.insert({ owner_id: a.requested_by, account_id: account.id, deal_id: dr.deal_id ?? null, title, is_customer_promise: false, due_at: isoAt(now), status: "open", source: "ai", voice_log_id: dr.voice_log_id ?? null });

    const card = await approvalCard(db, decided, drNext);
    const log = logOf(deps);
    const p = await pushToRepAndTeams(deps, db, a.requested_by, "approval.decided", { approval: card }, { now: deps.now, log });
    let injected = false;
    if (dr.buddy_conversation_id && deps.api) {
      try {
        await deps.api.post(EXTERNAL_EVENT_PATH(dr.buddy_conversation_id), { body: { event_id: `approval:${a.id}`, type: "merc.approval.decided", message: title.replace(/^Tell [^:]+: /, ""), metadata: { approval_id: a.id, status, approved_pct: approved }, trigger_turn: true, interrupt_current_turn: false } });
        injected = true;
      } catch (e) { log("warn", `external event into buddy conversation failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`); }
    } else if (dr.buddy_conversation_id) log("warn", "external event skipped: no service account on this function; the buddy polls approval-status instead");
    return { approval: card, requester_notified: p.pushed || injected };
  };
}
export const impl = makeImpl();
export const handle = defineWithApi("approval-decide", makeImpl);
