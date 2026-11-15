// fn:deals-list (contracts/functions/deals-list.json, scope account): the pipeline board's deals.
// Deals are visible through their account (REQ-CORE-009). Items carry tbl:deal columns plus joined
// account/owner names and the stage lookup (name, probability, closed/won flags).
// Also exports the paging and account-scope helpers that orders-list and tasks-list share.
import { accountScopeWhere, defineFunction, requireAccount, type Db, type Impl, type Principal, type Row, type Where } from "../../core/src/index";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

/** 1-based page + limit from a list request -> repo offset. Page is echoed back in the response. */
export function paging(req: { page?: number | null; limit?: number | null }): { page: number; limit: number; offset: number } {
  const page = Math.max(1, Math.floor(req.page ?? 1));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(req.limit ?? DEFAULT_LIMIT)));
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Ids of the accounts the principal may see, always org-bounded: child tables (deal, sales_order, task)
 * have no org_id, so even an admin's "everything" must be the org's accounts, never the whole table.
 */
export async function visibleAccountIds(db: Db, me: Principal): Promise<string[]> {
  const sets = accountScopeWhere(me);
  if (!sets) return (await db.account.all()).map((a) => a.id);
  const ids = new Set<string>();
  for (const s of sets) for (const a of await db.account.all(s)) ids.add(a.id);
  return [...ids];
}

/** Account ids for a list request: one checked account, or every visible one. */
export async function scopedAccountIds(db: Db, me: Principal, accountId?: string | null): Promise<string[]> {
  if (accountId) return [(await requireAccount(db, me, accountId)).id];
  return visibleAccountIds(db, me);
}

/** id -> row for the given ids (deduplicated, one query). */
export async function byId<N extends "account" | "app_user" | "product">(db: Db, table: N, ids: Array<string | null | undefined>): Promise<Map<string, Row<N>>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const rows = (await (db[table] as any).all({ id: want })) as Row<N>[];
  return new Map(rows.map((r) => [(r as { id: string }).id, r]));
}

export const impl: Impl<"deals-list"> = async ({ req, db, me }) => {
  const { page, limit, offset } = paging(req);
  const where: Where<"deal"> = { account_id: await scopedAccountIds(db, me, req.account_id) };
  if (req.owner_id) where.owner_id = req.owner_id;
  if (req.stage_code) where.stage_code = req.stage_code;
  const res = await db.deal.list(where, { limit, offset, orderBy: [{ column: "expected_close_date", direction: "asc" }, { column: "id", direction: "asc" }] });

  const stages = new Map((await db.deal_stage.all()).map((s) => [s.code, s]));
  const accounts = await byId(db, "account", res.items.map((d) => d.account_id));
  const owners = await byId(db, "app_user", res.items.map((d) => d.owner_id));
  const items = res.items.map((d) => {
    const s = stages.get(d.stage_code);
    const amount = d.amount_minor ?? 0;
    return {
      id: d.id,
      deal_id: d.id,
      account_id: d.account_id,
      account_name: accounts.get(d.account_id)?.name ?? null,
      owner_id: d.owner_id,
      owner_name: owners.get(d.owner_id)?.full_name ?? null,
      title: d.title,
      stage_code: d.stage_code,
      stage_name: s?.name ?? d.stage_code,
      probability: s?.probability ?? 0,
      is_closed: s?.is_closed ?? false,
      is_won: s?.is_won ?? false,
      amount_minor: amount,
      // metrics.md#weighted-pipeline, per deal: closed stages weigh 0.
      weighted_minor: s && !s.is_closed ? Math.round(amount * s.probability) : 0,
      expected_close_date: d.expected_close_date ?? null,
      next_step: d.next_step ?? null,
      last_activity_at: d.last_activity_at ?? null,
      closed_at: d.closed_at ?? null,
    };
  });
  return { items, page: { page, limit, total: res.total } };
};

export const handle = defineFunction("deals-list", impl);
