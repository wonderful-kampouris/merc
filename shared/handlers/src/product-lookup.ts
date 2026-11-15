// fn:product-lookup (contracts/functions/product-lookup.json, REQ-CRD-005): catalog answers (price, unit,
// availability) straight from tbl:product. Values are rows, never model output (REQ-CORE-003).
import { defineFunction, today, type Db, type Impl, type Row } from "../../core/src/index";

export type ProductItem = {
  product_id: string; sku: string; name: string; unit: string; list_price_minor: number;
  category: string | null; active_campaigns: string[]; stock: "unknown" | "in_stock" | "out_of_stock";
};

/** Lower case, accents removed, punctuation to spaces (so "Espresso-Nuovo" and "espresso nuovo" match). */
export const norm = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Tokens of 2+ chars, without filler words that carry no product meaning. */
const FILLER = new Set(["the", "a", "of", "how", "much", "is", "price", "for", "and", "to", "το", "η", "ο", "τι", "πόσο", "ποσο", "κάνει", "κανει", "τιμή", "τιμη"]);
export function tokens(q: string): string[] {
  return norm(q).split(" ").filter((t) => t.length >= 2 && !FILLER.has(t));
}

/**
 * Active products of the org matching the query: exact SKU first, then every token in name or SKU.
 * Ordered by match quality (SKU, name starts with query, shorter name), then name. Catalogs are small,
 * so matching runs in code (accent- and case-insensitive) over the org's active products.
 */
export async function findProducts(db: Db, query: string, limit = 10): Promise<Row<"product">[]> {
  const q = norm(query), toks = tokens(query);
  if (!q) return [];
  const products = await db.product.all({ active: true });
  const scored: Array<{ p: Row<"product">; s: number }> = [];
  for (const p of products) {
    const name = norm(p.name), sku = norm(p.sku);
    let s = -1;
    if (sku === q) s = 3;
    else if (name.startsWith(q)) s = 2;
    else if (toks.length && toks.every((t) => name.includes(t) || sku.includes(t))) s = 1;
    if (s >= 0) scored.push({ p, s });
  }
  scored.sort((a, b) => b.s - a.s || a.p.name.length - b.p.name.length || a.p.name.localeCompare(b.p.name));
  return scored.slice(0, limit).map((x) => x.p);
}

/** Contract items for products: category name and the titles of campaigns active on `day` that include them. */
export async function toItems(db: Db, products: Row<"product">[], day: string): Promise<ProductItem[]> {
  if (!products.length) return [];
  const catIds = [...new Set(products.map((p) => p.category_id).filter((x): x is string => !!x))];
  const cats = catIds.length ? await db.product_category.all({ id: catIds }) : [];
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const links = await db.campaign_product.all({ product_id: products.map((p) => p.id) });
  const campIds = [...new Set(links.map((l) => l.campaign_id))];
  const camps = campIds.length ? await db.campaign.all({ id: campIds, status: "active" }) : [];
  const live = new Map(camps.filter((c) => (!c.starts_on || c.starts_on <= day) && (!c.ends_on || c.ends_on >= day)).map((c) => [c.id, c.title]));
  return products.map((p) => ({
    product_id: p.id,
    sku: p.sku,
    name: p.name,
    unit: p.unit,
    list_price_minor: p.list_price_minor,
    category: (p.category_id && catName.get(p.category_id)) ?? null,
    active_campaigns: [...new Set(links.filter((l) => l.product_id === p.id && live.has(l.campaign_id)).map((l) => live.get(l.campaign_id)!))].sort(),
    // tbl:product has no stock column and there is no ERP stock feed (OPEN in contracts): always "unknown".
    stock: "unknown",
  }));
}

export interface ProductLookupDeps { now?: () => number }
export function makeImpl(deps: ProductLookupDeps = {}): Impl<"product-lookup"> {
  return async ({ req, db, me }) => {
    const day = today(me.org, deps.now?.() ?? Date.now());
    return { items: await toItems(db, await findProducts(db, req.query), day) };
  };
}
export const impl = makeImpl();

/** Wonderful Function entry (functions/product-lookup/index.ts calls this). */
export const handle = defineFunction("product-lookup", impl);
