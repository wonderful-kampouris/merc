// fn:campaign-upsert (contracts/functions/campaign-upsert.json, REQ-CMP-002): create or edit a campaign and its
// targeting links (products, territories, account categories, reps). Active campaigns reach the targeted reps'
// briefings and visit cards (briefing-generate / visit-card-get read the same link tables).
// Scope: admin anywhere; a manager only targets their team's territories and reps, must target at least one of them
// (an untargeted campaign reaches the whole org), and edits only campaigns created by them or their team.
import {
  defineFunction, forbidden, invalid, isAdmin, isOwnerOrTeam, notFound, requireUser, visibleTerritoryIds, visibleUserIds,
  type Db, type Impl, type Principal,
} from "../../core/src/index";
import { loadLinks, type CampaignLinks } from "./campaigns-list";

type LinkTable = "campaign_product" | "campaign_territory" | "campaign_category" | "campaign_rep";
const LINKS: Array<{ key: keyof CampaignLinks; table: LinkTable; col: string }> = [
  { key: "product_ids", table: "campaign_product", col: "product_id" },
  { key: "territory_ids", table: "campaign_territory", col: "territory_id" },
  { key: "category_ids", table: "campaign_category", col: "category_id" },
  { key: "rep_ids", table: "campaign_rep", col: "user_id" },
];
const uniq = (xs: string[]) => [...new Set(xs)];

async function requireAll(db: Db, table: "product" | "territory" | "account_category" | "app_user", ids: string[], field: string) {
  if (!ids.length) return [];
  const rows = await db[table].all({ id: ids } as never) as unknown as Array<{ id: string } & Record<string, unknown>>;
  const missing = ids.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) throw invalid(`unknown ${field}: ${missing.join(", ")}`, { field, missing });
  return rows;
}

export const impl: Impl<"campaign-upsert", Principal> = async ({ req, db, me }) => {
  const user = requireUser(me, "campaign-upsert");
  const title = req.title.trim(), message = req.message.trim();
  if (!title) throw invalid("title is required", { field: "title" });
  if (!message) throw invalid("message is required", { field: "message" });
  if (req.ends_on < req.starts_on) throw invalid("ends_on must be on or after starts_on", { starts_on: req.starts_on, ends_on: req.ends_on });
  const want: CampaignLinks = { product_ids: uniq(req.product_ids), territory_ids: uniq(req.territory_ids), category_ids: uniq(req.category_ids), rep_ids: uniq(req.rep_ids) };

  await requireAll(db, "product", want.product_ids, "product_ids");
  await requireAll(db, "territory", want.territory_ids, "territory_ids");
  await requireAll(db, "account_category", want.category_ids, "category_ids");
  const reps = await requireAll(db, "app_user", want.rep_ids, "rep_ids");
  const badRep = reps.find((r) => r.role_code !== "rep" || r.status !== "active");
  if (badRep) throw invalid(`rep_ids: ${badRep.id} is not an active rep`, { field: "rep_ids", id: badRep.id });

  if (!isAdmin(me)) {
    const terr = visibleTerritoryIds(me)!, users = visibleUserIds(me)!;
    const outT = want.territory_ids.filter((t) => !terr.includes(t)), outR = want.rep_ids.filter((r) => !users.includes(r));
    if (outT.length || outR.length) throw forbidden("campaign targets are outside your team", { territory_ids: outT, rep_ids: outR });
    if (!want.territory_ids.length && !want.rep_ids.length) throw forbidden("target at least one territory or rep of your team (an untargeted campaign reaches the whole org)");
  }

  let campaignId: string;
  if (req.campaign_id) {
    const existing = await db.campaign.get(req.campaign_id);
    if (!existing) throw notFound("campaign not found", { campaign_id: req.campaign_id });
    if (!isOwnerOrTeam(me, existing.created_by)) throw forbidden("campaign is outside your scope");
    await db.campaign.update(existing.id, { title, message, starts_on: req.starts_on, ends_on: req.ends_on, status: req.status });
    campaignId = existing.id;
  } else {
    const row = await db.campaign.insert({ created_by: user.id, title, message, starts_on: req.starts_on, ends_on: req.ends_on, status: req.status } as never);
    campaignId = row.id;
  }

  // Sync links: delete removed, insert added (unique per campaign + target).
  const have = (await loadLinks(db, [campaignId])).get(campaignId)!;
  for (const { key, table, col } of LINKS) {
    const add = want[key].filter((id) => !have[key].includes(id));
    const drop = have[key].filter((id) => !want[key].includes(id));
    if (drop.length) {
      const rows = await (db[table] as any).all({ campaign_id: campaignId, [col]: drop }) as Array<{ id: string }>;
      for (const r of rows) await (db[table] as any).delete(r.id);
    }
    for (const id of add) await (db[table] as any).insert({ campaign_id: campaignId, [col]: id });
  }
  return { campaign_id: campaignId };
};

export const handle = defineFunction("campaign-upsert", impl);
