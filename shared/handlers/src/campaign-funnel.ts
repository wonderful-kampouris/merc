// fn:campaign-funnel (contracts/functions/campaign-funnel.json, REQ-CMP-003, metrics.md#campaign-funnel):
//   shown   - campaign_exposure `shown` rows (visit card opened) inside the campaign window, max one per account per
//             rep per local day; plus one per rep per day the campaign was a briefing item (briefing_item ref campaign).
//   pitched - campaign_exposure `pitched` rows (written by debrief-process only after evidence validation, REQ-DEB-008).
//   ordered - a confirmed order line with a campaign product, for an account with a pitched exposure, dated between the
//             pitch date and ends_on + 7 days; counted once per (account, rep). Explicit `ordered` exposures count too.
// Scope (dashboard): reps see their own numbers, managers their team, admin everyone.
import { addDays, dashboardRepIds, defineFunction, localDate, notFound, type Impl, type Principal, type Row } from "../../core/src/index";

type RepCount = { rep_id: string; full_name: string; shown: number; pitched: number; ordered: number };

const occurredDay = (tz: { timezone: string }, x: Row<"campaign_exposure">): string | null => {
  const at = x.occurred_at ?? (x as unknown as { created_at?: number }).created_at;
  return at ? localDate(tz, at as string | number) : null;
};

export const impl: Impl<"campaign-funnel", Principal> = async ({ req, db, me }) => {
  const campaign = await db.campaign.get(req.campaign_id);
  if (!campaign) throw notFound("campaign not found", { campaign_id: req.campaign_id });
  const repScope = dashboardRepIds(me);
  const inScope = (repId: string | null | undefined) => !!repId && (repScope === null || repScope.includes(repId));
  const from = campaign.starts_on, to = campaign.ends_on, orderUntil = addDays(campaign.ends_on, 7);

  const exposures = (await db.campaign_exposure.all({ campaign_id: campaign.id })).filter((x) => inScope(x.rep_id));
  const byRep = new Map<string, RepCount>();
  const rep = (id: string) => { let r = byRep.get(id); if (!r) { r = { rep_id: id, full_name: "", shown: 0, pitched: 0, ordered: 0 }; byRep.set(id, r); } return r; };

  // shown: exposures + briefing items, deduped per (rep, account|briefing, day), inside the window
  const shownKeys = new Set<string>();
  for (const x of exposures.filter((e) => e.stage === "shown")) {
    const d = occurredDay(me.org, x);
    if (!d || d < from || d > to) continue;
    const k = `${x.rep_id}|${x.account_id}|${d}`;
    if (shownKeys.has(k)) continue;
    shownKeys.add(k); rep(x.rep_id).shown++;
  }
  const items = await db.briefing_item.all({ ref_table: "campaign", ref_id: campaign.id } as never);
  if (items.length) {
    const briefings = await db.briefing.all({ id: [...new Set(items.map((i) => i.briefing_id))] } as never);
    for (const b of briefings) {
      if (!inScope(b.rep_id) || b.briefing_date < from || b.briefing_date > to) continue;
      const k = `${b.rep_id}|briefing|${b.briefing_date}`;
      if (shownKeys.has(k)) continue;
      shownKeys.add(k); rep(b.rep_id).shown++;
    }
  }

  // pitched
  const pitched = exposures.filter((e) => e.stage === "pitched");
  for (const x of pitched) rep(x.rep_id).pitched++;

  // ordered: first pitch per (account, rep), then a confirmed campaign-product order in [pitch day, ends_on + 7]
  const orderedKeys = new Set<string>();
  for (const x of exposures.filter((e) => e.stage === "ordered")) {
    const k = `${x.rep_id}|${x.account_id}`;
    if (!orderedKeys.has(k)) { orderedKeys.add(k); rep(x.rep_id).ordered++; }
  }
  const firstPitch = new Map<string, { rep_id: string; account_id: string; day: string }>();
  for (const x of pitched) {
    const d = occurredDay(me.org, x) ?? from, k = `${x.rep_id}|${x.account_id}`;
    const cur = firstPitch.get(k);
    if (!cur || d < cur.day) firstPitch.set(k, { rep_id: x.rep_id, account_id: x.account_id, day: d });
  }
  const pending = [...firstPitch.entries()].filter(([k]) => !orderedKeys.has(k));
  if (pending.length) {
    const productIds = new Set((await db.campaign_product.all({ campaign_id: campaign.id })).map((p) => p.product_id));
    const orders = productIds.size ? await db.sales_order.all({ account_id: [...new Set(pending.map(([, p]) => p.account_id))], status: "confirmed" } as never) : [];
    const lines = orders.length ? await db.order_line.all({ order_id: orders.map((o) => o.id) } as never) : [];
    const withProduct = new Set(lines.filter((l) => productIds.has(l.product_id)).map((l) => l.order_id));
    for (const [k, p] of pending) {
      const hit = orders.some((o) => o.account_id === p.account_id && withProduct.has(o.id) && !!o.order_date && o.order_date >= p.day && o.order_date <= orderUntil);
      if (hit) { orderedKeys.add(k); rep(p.rep_id).ordered++; }
    }
  }

  const users = byRep.size ? await db.app_user.all({ id: [...byRep.keys()] } as never) : [];
  for (const u of users) { const r = byRep.get(u.id); if (r) r.full_name = u.full_name; }
  const by_rep = [...byRep.values()].sort((a, b) => b.pitched - a.pitched || b.shown - a.shown || a.full_name.localeCompare(b.full_name));
  const sum = (k: "shown" | "pitched" | "ordered") => by_rep.reduce((s, r) => s + r[k], 0);
  return { shown: sum("shown"), pitched: sum("pitched"), ordered: sum("ordered"), by_rep };
};

export const handle = defineFunction("campaign-funnel", impl);
