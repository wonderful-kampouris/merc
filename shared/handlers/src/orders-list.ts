// fn:orders-list (contracts/functions/orders-list.json, scope account): orders of visible accounts,
// newest first, as OrderSummary (_defs.json). from/to filter order_date (org-local dates, inclusive).
import { defineFunction, type Impl, type Where } from "../../core/src/index";
import { byId, paging, scopedAccountIds } from "./deals-list";
import { orderSummary } from "./order-upsert";

export const impl: Impl<"orders-list"> = async ({ req, db, me }) => {
  const { page, limit, offset } = paging(req);
  const where: Where<"sales_order"> = { account_id: await scopedAccountIds(db, me, req.account_id) };
  if (req.rep_id) where.rep_id = req.rep_id;
  const and = [
    ...(req.from ? [{ column: "order_date", operator: "gte" as const, value: req.from }] : []),
    ...(req.to ? [{ column: "order_date", operator: "lte" as const, value: req.to }] : []),
  ];
  const res = await db.sales_order.list(where, { limit, offset, and, orderBy: [{ column: "order_date", direction: "desc" }, { column: "id", direction: "asc" }] });
  const lines = res.items.length ? await db.order_line.all({ order_id: res.items.map((o) => o.id) }) : [];
  const products = await byId(db, "product", lines.map((l) => l.product_id));
  const items = res.items.map((o) => orderSummary(o, lines.filter((l) => l.order_id === o.id), products));
  return { items, page: { page, limit, total: res.total } };
};

export const handle = defineFunction("orders-list", impl);
