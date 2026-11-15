// fn:competitor-signals-list (contracts/functions/competitor-signals-list.json, REQ-DSH-006). Gate team.read, scope team.
// The competition view: competitor signals of the accounts the caller may see (REQ-CORE-009), filtered by competitor,
// territory (the account's territory) and time (observed on or after `from`, a local date in the org timezone),
// newest first, paged. Items are flat rows with the joined competitor, account, territory and reporter names.
// tbl:competitor_signal has no org_id, so the account set always comes from the caller's org.
import { defineFunction, invalid, isDate, localDate, type Impl, type Row } from "../../core/src/index";
import { byId, paging, visibleAccountIds } from "./deals-list";
import { inChunks } from "./metrics-rollup";

export const impl: Impl<"competitor-signals-list"> = async ({ req, db, me }) => {
  const { page, limit, offset } = paging(req);
  if (req.from != null && !isDate(req.from)) throw invalid("from must be a date (YYYY-MM-DD)", { from: req.from });
  let accounts = await inChunks(await visibleAccountIds(db, me), (c) => db.account.all({ id: c }));
  if (req.territory_id) accounts = accounts.filter((a) => a.territory_id === req.territory_id);
  const accById = new Map(accounts.map((a) => [a.id, a]));
  let signals = await inChunks([...accById.keys()], (c) => db.competitor_signal.all(req.competitor_id ? { account_id: c, competitor_id: req.competitor_id } : { account_id: c }));
  if (req.from) signals = signals.filter((s) => localDate(me.org, s.observed_at) >= req.from!);
  signals.sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at) || a.id.localeCompare(b.id));
  const shown = signals.slice(offset, offset + limit);
  const competitors = new Map((await db.competitor.all()).map((c) => [c.id, c]));
  const territories = new Map((await db.territory.all()).map((t) => [t.id, t]));
  const users = await byId(db, "app_user", shown.map((s) => s.reported_by));
  const items = shown.map((s) => {
    const a = accById.get(s.account_id) as Row<"account">;
    const t = a.territory_id ? territories.get(a.territory_id) : undefined;
    return {
      id: s.id,
      competitor_id: s.competitor_id,
      competitor_name: competitors.get(s.competitor_id)?.name ?? null,
      account_id: s.account_id,
      account_name: a.name,
      territory_id: a.territory_id ?? null,
      territory_name: t?.name ?? null,
      reported_by: s.reported_by,
      reported_by_name: users.get(s.reported_by)?.full_name ?? null,
      statement: s.statement,
      price_delta_pct: s.price_delta_pct ?? null,
      observed_at: s.observed_at,
      observed_day: localDate(me.org, s.observed_at),
      voice_log_id: s.voice_log_id ?? null,
    };
  });
  return { items, page: { page, limit, total: signals.length } };
};

/** Wonderful Function entry (functions/competitor-signals-list/index.ts calls this). */
export const handle = defineFunction("competitor-signals-list", impl);
