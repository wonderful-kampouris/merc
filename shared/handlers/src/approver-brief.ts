// fn:approver-brief (contracts/functions/approver-brief.json, REQ-DSC-003): what merc-approver says first.
// spoken_brief is ONE sentence built from rows only (no LLM numbers), in the callee's language.
import { assertRequesterOrApprover, defineFunction, invalid, type Impl, type Principal } from "../../core/src/index";
import { accountRef, nowOf, pct, resolveLimit, userRef, type DiscountDeps } from "./discount-check";
import { requireApproval } from "./discount-request";

const UNIT_EL: Record<string, string> = { kg: "κιλά", piece: "τεμάχια", box: "κιβώτια", litre: "λίτρα", pack: "πακέτα" };
const UNIT_EN: Record<string, string> = { kg: "kg", piece: "pcs", box: "boxes", litre: "L", pack: "packs" };

export function spokenBrief(lang: string, x: { requester: string; account: string; requested: number; limit: number; lines: Array<{ name: string; quantity: number; unit: string }> }): string {
  const el = lang === "el";
  const u = el ? UNIT_EL : UNIT_EN;
  const items = x.lines.map((l) => `${l.quantity} ${u[l.unit] ?? l.unit} ${l.name}`).join(el ? " και " : " and ");
  return el
    ? `${x.requester} ζητά έκπτωση ${pct(x.requested)} για ${x.account} σε ${items}, ενώ το όριό του είναι ${pct(x.limit)}.`
    : `${x.requester} asks for ${pct(x.requested)} off for ${x.account} on ${items}, above their limit of ${pct(x.limit)}.`;
}

export function makeImpl(deps: DiscountDeps = {}): Impl<"approver-brief", Principal> {
  return async ({ req, db, me }) => {
    const a = await requireApproval(db, req.approval_id);
    if (me.kind === "user") assertRequesterOrApprover(me, a);
    if (a.kind !== "discount") throw invalid("approver-brief is only for discount approvals", { kind: a.kind });
    const dr = await db.discount_request.findOne({ approval_id: a.id });
    if (!dr) throw invalid("approval has no discount request", { approval_id: a.id });
    const [callee, requester, account, lineRows] = await Promise.all([
      db.app_user.require(a.approver_id), db.app_user.require(a.requested_by), db.account.require(dr.account_id),
      db.discount_request_line.all({ discount_request_id: dr.id }),
    ]);
    const products = await db.product.all({ id: lineRows.map((l) => l.product_id) });
    const lines = lineRows.map((l) => { const p = products.find((x) => x.id === l.product_id); return { name: p?.name ?? "product", quantity: l.quantity, unit: p?.unit ?? "piece" }; });
    const org = await db.organization.require(db.orgId!);
    const approverLimit = (await resolveLimit(db, org, callee, account, lineRows.map((l) => l.product_id), nowOf(deps))).limit_pct;
    const lang = callee.preferred_language || org.default_language || "el";

    const facts: string[] = [];
    if (dr.justification) facts.push(`Justification: ${dr.justification}`);
    const m = await db.account_metrics.findOne({ account_id: account.id });
    if (m?.last_order_date) facts.push(`Last order ${m.last_order_date}${m.days_since_last_order != null ? ` (${m.days_since_last_order} days ago)` : ""}`);
    if (m?.avg_order_interval_days != null) facts.push(`Orders every ${m.avg_order_interval_days} days on average`);
    if (m?.risk_score != null) facts.push(`Risk score ${m.risk_score}${m.risk_reasons ? `: ${m.risk_reasons}` : ""}`);
    if (!m?.last_order_date) {
      const o = (await db.sales_order.list({ account_id: account.id, status: "confirmed" }, { limit: 1, orderBy: [{ column: "order_date", direction: "desc" }] })).items[0];
      if (o) facts.push(`Last confirmed order ${o.order_date}`);
    }
    const signals = (await db.competitor_signal.list({ account_id: account.id }, { limit: 2, orderBy: [{ column: "observed_at", direction: "desc" }] })).items;
    for (const s of signals) facts.push(`Competitor: ${s.statement}${s.price_delta_pct != null ? ` (${s.price_delta_pct}% price difference)` : ""}`);

    return {
      approval_id: a.id, callee: userRef(callee), requester: userRef(requester), account: accountRef(account),
      requested_pct: dr.requested_pct, policy_limit_pct: dr.policy_limit_pct, approver_limit_pct: approverLimit,
      lines, context_facts: facts,
      spoken_brief: spokenBrief(lang, { requester: requester.full_name, account: account.name, requested: dr.requested_pct, limit: dr.policy_limit_pct, lines }),
    };
  };
}
export const impl = makeImpl();
// GET, user callers (approver or requester from the app); merc-approver calls impl with its own principal.
export const handle = defineFunction("approver-brief", impl);
