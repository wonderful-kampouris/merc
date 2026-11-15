// fn:alerts-list (contracts/functions/alerts-list.json, REQ-ALR-001/004). Gate alerts.read, scope owner_or_team.
//   scope mine (default): alerts whose recipient is the caller.
//   scope team: manager -> self + direct and indirect reports; admin -> every user of the org; rep -> forbidden.
// tbl:alert has no org_id, so the recipient set always comes from the caller's org.
import { defineFunction, forbidden, isAdmin, isManager, type Db, type Impl, type Principal, type Row } from "../../core/src/index";
import type { AlertCard } from "../../core/src/generated/contracts/types";
import { epochMs, inChunks } from "./metrics-rollup";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

type AccountLite = Pick<Row<"account">, "id" | "name" | "account_type" | "postal_code">;
/** AlertCard (contracts/_defs.json) of one alert row. */
export function toCard(a: Row<"alert">, type: Pick<Row<"alert_type">, "suggested_action"> | null, account: AccountLite | null): AlertCard {
  const ms = epochMs(a.created_at) ?? 0;
  return {
    alert_id: a.id,
    type: a.alert_type_code,
    severity: a.severity as AlertCard["severity"],
    status: a.status as AlertCard["status"],
    message: a.message,
    account: account ? { id: account.id, name: account.name, account_type: account.account_type as "customer", postal_code: account.postal_code ?? null } : null,
    suggested_action: type?.suggested_action ?? null,
    created_at: new Date(ms).toISOString(),
  };
}

/** Cards for many alerts with one lookup per table. */
export async function cardsFor(db: Db, alerts: Row<"alert">[]): Promise<AlertCard[]> {
  const types = new Map((await db.alert_type.all()).map((t) => [t.code, t]));
  const accIds = alerts.map((a) => a.account_id).filter((x): x is string => !!x);
  const accounts = new Map((await inChunks(accIds, (c) => db.account.all({ id: c }))).map((a) => [a.id, a]));
  return alerts.map((a) => toCard(a, types.get(a.alert_type_code) ?? null, a.account_id ? accounts.get(a.account_id) ?? null : null));
}

/** Recipients whose alerts the principal may list for a scope. */
export async function recipientsFor(db: Db, me: Principal, scope: "mine" | "team"): Promise<string[]> {
  if (scope === "mine") {
    if (me.kind !== "user") throw forbidden("scope mine needs a signed-in Merc user");
    return [me.id];
  }
  if (isAdmin(me)) return (await db.app_user.all()).map((u) => u.id);
  if (isManager(me)) return [me.id, ...me.team_user_ids];
  throw forbidden("scope team is for managers and admins");
}

export const impl: Impl<"alerts-list"> = async ({ req, db, me }) => {
  const limit = Math.min(Math.max(req.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = Math.max(req.page ?? 1, 1);
  const recipients = await recipientsFor(db, me, req.scope ?? "mine");
  const res = await db.alert.list({ recipient_id: recipients, status: req.status ?? "open" }, {
    limit, offset: (page - 1) * limit, orderBy: [{ column: "created_at", direction: "desc" }, { column: "id", direction: "asc" }],
  });
  return { items: await cardsFor(db, res.items), page: { page, limit, total: res.total } };
};

export const handle = defineFunction("alerts-list", impl);
