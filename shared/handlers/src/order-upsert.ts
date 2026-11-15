// fn:order-upsert (contracts/functions/order-upsert.json, scope account, REQ-DEB-010).
// Order intent creates a DRAFT tbl:sales_order. Confirming is a separate, explicit call on an existing
// draft (draft -> confirmed), so "put down 12 kilos" stays a draft until the rep says yes.
//   new order          : status must be "draft" (confirmed -> needs_confirmation, cancelled -> validation_failed)
//   draft -> draft     : lines replaced
//   draft -> confirmed : lines replaced, order_date = today (org tz)
//   draft|confirmed -> cancelled : status only, lines kept
//   confirmed -> confirmed : idempotent when lines are empty or unchanged, else conflict
//   cancelled -> *, confirmed -> draft : conflict
// Prices default to the product list price. A line discount above the rep's limit (metrics.md#discount-limit)
// is refused with blocked_by_policy unless the rep holds an approved discount_request covering it.
import {
  assertOwner, blocked, conflict, defineFunction, invalid, needsConfirmation, requireAccount, today,
  type Db, type Impl, type Row, type UserPrincipal,
} from "../../core/src/index";
import type { FunctionResponseMap } from "../../core/src/generated/contracts/types";

type OrderSummary = FunctionResponseMap["order-upsert"]["order"];
type ReqLine = { product_id: string; quantity: number; unit_price_minor?: number | null; discount_pct?: number | null };
type Line = { product_id: string; quantity: number; unit_price_minor: number; discount_pct: number };

/** metrics.md revenue rule per line: quantity x unit_price_minor x (1 - discount_pct/100), rounded to minor units. */
export const lineTotal = (l: { quantity: number; unit_price_minor: number; discount_pct?: number | null }) =>
  Math.round(l.quantity * l.unit_price_minor * (1 - (l.discount_pct ?? 0) / 100));

/** The OrderSummary of _defs.json (shared by orders-list). */
export function orderSummary(order: Row<"sales_order">, lines: Row<"order_line">[], products: Map<string, Row<"product">>): OrderSummary {
  const sorted = [...lines].sort((a, b) => a.line_no - b.line_no);
  return {
    order_id: order.id,
    order_date: order.order_date,
    status: order.status,
    total_minor: sorted.reduce((s, l) => s + lineTotal(l), 0),
    lines: sorted.map((l) => {
      const p = products.get(l.product_id);
      return { product_id: l.product_id, name: p?.name ?? "", quantity: l.quantity, unit: p?.unit ?? "" };
    }),
  };
}

const inWindow = (p: Row<"discount_policy">, day: string) => p.active && (!p.valid_from || p.valid_from <= day) && (!p.valid_to || p.valid_to >= day);

/** metrics.md#discount-limit: first match, most specific first; none -> 0. */
export function discountLimit(policies: Row<"discount_policy">[], me: Pick<UserPrincipal, "id" | "role">, productCategoryId: string | null, accountCategoryId: string | null): { limit_pct: number; policy_id: string | null } {
  const role = policies.filter((p) => p.role_code === me.role && !p.user_id);
  const pick =
    policies.find((p) => p.user_id === me.id) ??
    role.find((p) => p.product_category_id === productCategoryId && !!productCategoryId && p.account_category_id === accountCategoryId && !!accountCategoryId) ??
    role.find((p) => p.product_category_id === productCategoryId && !!productCategoryId && !p.account_category_id) ??
    role.find((p) => !p.product_category_id && !p.account_category_id);
  return pick ? { limit_pct: pick.max_discount_pct, policy_id: pick.id } : { limit_pct: 0, policy_id: null };
}

/** Approved discount grants of this rep on this account: approved_pct and optional product list per request. */
async function approvedGrants(db: Db, me: UserPrincipal, accountId: string, nowIso: string): Promise<Array<{ pct: number; products: Set<string> | null }>> {
  const out: Array<{ pct: number; products: Set<string> | null }> = [];
  for (const r of await db.discount_request.all({ account_id: accountId })) {
    const a = await db.approval.get(r.approval_id);
    if (!a || a.kind !== "discount" || a.requested_by !== me.id || !["approved", "countered"].includes(a.status)) continue;
    if (a.expires_at && a.expires_at <= nowIso) continue;
    const pct = r.approved_pct ?? (a.status === "approved" ? r.requested_pct : null);
    if (pct === null || pct === undefined) continue;
    const lines = await db.discount_request_line.all({ discount_request_id: r.id });
    out.push({ pct, products: lines.length ? new Set(lines.map((l) => l.product_id)) : null });
  }
  return out;
}

/** Validate request lines: products active in the org, quantity > 0, prices/discounts in range, discount policy. */
async function resolveLines(db: Db, me: UserPrincipal, account: Row<"account">, lines: ReqLine[]): Promise<{ lines: Line[]; products: Map<string, Row<"product">> }> {
  if (!lines.length) throw invalid("an order needs at least one line");
  const errors: string[] = [];
  const ids = [...new Set(lines.map((l) => l.product_id))];
  const products = new Map((await db.product.all({ id: ids })).map((p) => [p.id, p]));
  const out: Line[] = lines.map((l, i) => {
    const p = products.get(l.product_id);
    if (!p) errors.push(`lines[${i}].product_id: unknown product`);
    else if (!p.active) errors.push(`lines[${i}].product_id: product ${p.sku} is not active`);
    if (!(typeof l.quantity === "number" && Number.isFinite(l.quantity) && l.quantity > 0)) errors.push(`lines[${i}].quantity: must be > 0`);
    const price = l.unit_price_minor ?? p?.list_price_minor ?? 0;
    if (!Number.isInteger(price) || price < 0) errors.push(`lines[${i}].unit_price_minor: non-negative integer`);
    const disc = l.discount_pct ?? 0;
    if (!(disc >= 0 && disc <= 100)) errors.push(`lines[${i}].discount_pct: 0-100`);
    return { product_id: l.product_id, quantity: l.quantity, unit_price_minor: price, discount_pct: disc };
  });
  if (errors.length) throw invalid(`invalid order lines: ${errors.slice(0, 3).join("; ")}`, { errors });

  const discounted = out.filter((l) => l.discount_pct > 0);
  if (discounted.length) {
    const day = today(me.org);
    const policies = (await db.discount_policy.all({ active: true })).filter((p) => inWindow(p, day));
    let grants: Awaited<ReturnType<typeof approvedGrants>> | null = null;
    for (const l of discounted) {
      const p = products.get(l.product_id)!;
      const { limit_pct, policy_id } = discountLimit(policies, me, p.category_id ?? null, account.category_id ?? null);
      if (l.discount_pct <= limit_pct) continue;
      grants ??= await approvedGrants(db, me, account.id, new Date().toISOString());
      if (grants.some((g) => g.pct >= l.discount_pct && (!g.products || g.products.has(l.product_id)))) continue;
      throw blocked(`discount ${l.discount_pct}% on ${p.name} is above your limit of ${limit_pct}%; ask for approval first`, {
        product_id: p.id, discount_pct: l.discount_pct, limit_pct, policy_id, how: "request a discount approval (fn:discount-request), then confirm the order",
      });
    }
  }
  return { lines: out, products };
}

async function writeLines(db: Db, orderId: string, lines: Line[], replace: boolean): Promise<Row<"order_line">[]> {
  if (replace) for (const old of await db.order_line.all({ order_id: orderId })) await db.order_line.delete(old.id);
  const rows: Row<"order_line">[] = [];
  for (const [i, l] of lines.entries()) rows.push(await db.order_line.insert({ order_id: orderId, line_no: i + 1, ...l }));
  return rows;
}

const sameLines = (a: Array<{ product_id: string; quantity: number }>, b: Array<{ product_id: string; quantity: number }>) =>
  a.length === b.length && a.every((l, i) => l.product_id === b[i]!.product_id && l.quantity === b[i]!.quantity);

async function summaryOf(db: Db, order: Row<"sales_order">): Promise<OrderSummary> {
  const lines = await db.order_line.all({ order_id: order.id });
  const products = new Map((await db.product.all({ id: [...new Set(lines.map((l) => l.product_id))] })).map((p) => [p.id, p]));
  return orderSummary(order, lines, products);
}

export const impl: Impl<"order-upsert"> = async ({ req, db, me }) => {
  const account = await requireAccount(db, me, req.account_id);

  if (!req.order_id) {
    if (req.status === "confirmed") throw needsConfirmation("a new order is saved as a draft; confirm it in a second call after the rep says yes", { status: "draft" });
    if (req.status === "cancelled") throw invalid("cannot create a cancelled order");
    const { lines, products } = await resolveLines(db, me, account, req.lines);
    const order = await db.sales_order.insert({ account_id: account.id, rep_id: me.id, status: "draft", source: "manual", order_date: today(me.org) });
    try {
      return { order: orderSummary(order, await writeLines(db, order.id, lines, false), products) };
    } catch (e) {
      // Undo the half-written draft (lines first, then the order) so a failed call leaves nothing behind.
      try { for (const l of await db.order_line.all({ order_id: order.id })) await db.order_line.delete(l.id); await db.sales_order.delete(order.id); } catch { /* keep the original error */ }
      throw e;
    }
  }

  const order = await db.sales_order.require(req.order_id);
  if (order.account_id !== account.id) throw invalid("order belongs to another account", { order_id: order.id, account_id: account.id });
  assertOwner(me, order.rep_id, "order");
  if (order.status === "cancelled") throw conflict("order is cancelled", { order_id: order.id, status: order.status });

  if (req.status === "cancelled") return { order: await summaryOf(db, await db.sales_order.update(order.id, { status: "cancelled" })) };
  if (order.status === "confirmed") {
    if (req.status === "draft") throw conflict("a confirmed order cannot go back to draft", { order_id: order.id });
    const current = await summaryOf(db, order);
    if (req.lines.length && !sameLines(req.lines, current.lines)) throw conflict("a confirmed order cannot be edited", { order_id: order.id });
    return { order: current };
  }
  // draft -> draft | confirmed
  const { lines, products } = await resolveLines(db, me, account, req.lines);
  const patch = req.status === "confirmed" ? { status: "confirmed" as const, order_date: today(me.org) } : {};
  const updated = Object.keys(patch).length ? await db.sales_order.update(order.id, patch) : order;
  return { order: orderSummary(updated, await writeLines(db, order.id, lines, true), products) };
};

export const handle = defineFunction("order-upsert", impl);
