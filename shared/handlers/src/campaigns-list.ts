// fn:campaigns-list (contracts/functions/campaigns-list.json, REQ-CMP-002): campaigns with their targeting links.
// Admin and managers see every campaign of the org (the management screen). Reps see only campaigns that are not
// drafts and target them: untargeted, one of their territories, or them by name (same rule as briefing/visit card).
// Each item carries the link ids (product_ids, territory_ids, category_ids, rep_ids) so an edit round-trips through
// fn:campaign-upsert without clearing links, plus display names.
import { defineFunction, isAdmin, isManager, type Db, type Impl, type Principal, type Row } from "../../core/src/index";

export interface CampaignLinks {
  product_ids: string[];
  territory_ids: string[];
  category_ids: string[];
  rep_ids: string[];
}

/** Link ids of the given campaigns (one round trip per link table). */
export async function loadLinks(db: Db, campaignIds: string[]): Promise<Map<string, CampaignLinks>> {
  const out = new Map<string, CampaignLinks>(campaignIds.map((id) => [id, { product_ids: [], territory_ids: [], category_ids: [], rep_ids: [] }]));
  if (!campaignIds.length) return out;
  const [p, t, c, r] = await Promise.all([
    db.campaign_product.all({ campaign_id: campaignIds }),
    db.campaign_territory.all({ campaign_id: campaignIds }),
    db.campaign_category.all({ campaign_id: campaignIds }),
    db.campaign_rep.all({ campaign_id: campaignIds }),
  ]);
  for (const x of p) out.get(x.campaign_id)?.product_ids.push(x.product_id);
  for (const x of t) out.get(x.campaign_id)?.territory_ids.push(x.territory_id);
  for (const x of c) out.get(x.campaign_id)?.category_ids.push(x.category_id);
  for (const x of r) out.get(x.campaign_id)?.rep_ids.push(x.user_id);
  return out;
}

/** A campaign targets a rep when it has no territory/rep targets, or one of their territories, or them. */
export function targetsRep(links: CampaignLinks, repId: string, repTerritoryIds: string[]): boolean {
  if (!links.territory_ids.length && !links.rep_ids.length) return true;
  return links.rep_ids.includes(repId) || links.territory_ids.some((t) => repTerritoryIds.includes(t));
}

const seesAll = (me: Principal) => isAdmin(me) || isManager(me);

export const impl: Impl<"campaigns-list", Principal> = async ({ req, db, me }) => {
  const where: Partial<Record<"status", string>> = req.status ? { status: req.status } : {};
  let rows = await db.campaign.all(where as never);
  if (!seesAll(me)) rows = rows.filter((c) => c.status !== "draft");
  const links = await loadLinks(db, rows.map((c) => c.id));
  if (!seesAll(me)) rows = rows.filter((c) => targetsRep(links.get(c.id)!, me.id, me.territory_ids));
  if (!rows.length) return { items: [] };

  const all = [...links.values()];
  const uniq = (xs: string[]) => [...new Set(xs)];
  const [products, territories, categories, reps] = await Promise.all([
    nameMap(db.product.all({ id: uniq(all.flatMap((l) => l.product_ids)) } as never), "name"),
    nameMap(db.territory.all({ id: uniq(all.flatMap((l) => l.territory_ids)) } as never), "name"),
    nameMap(db.account_category.all({ id: uniq(all.flatMap((l) => l.category_ids)) } as never), "name"),
    nameMap(db.app_user.all({ id: uniq(all.flatMap((l) => l.rep_ids)) } as never), "full_name"),
  ]);
  const rank = { active: 0, draft: 1, ended: 2 } as Record<string, number>;
  rows.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || b.starts_on.localeCompare(a.starts_on) || a.title.localeCompare(b.title));
  const names = (ids: string[], m: Map<string, string>) => ids.map((id) => m.get(id)).filter((n): n is string => !!n);
  return {
    items: rows.map((c) => {
      const l = links.get(c.id)!;
      return {
        id: c.id, campaign_id: c.id, title: c.title, message: c.message, starts_on: c.starts_on, ends_on: c.ends_on, status: c.status,
        created_by: c.created_by,
        ...l,
        product_names: names(l.product_ids, products), territory_names: names(l.territory_ids, territories),
        category_names: names(l.category_ids, categories), rep_names: names(l.rep_ids, reps),
      };
    }),
  };
};

async function nameMap<R extends { id: string }>(rows: Promise<R[]>, key: keyof R): Promise<Map<string, string>> {
  return new Map((await rows).map((r) => [r.id, String(r[key] ?? "")]));
}

export type CampaignRow = Row<"campaign">;
export const handle = defineFunction("campaigns-list", impl);
