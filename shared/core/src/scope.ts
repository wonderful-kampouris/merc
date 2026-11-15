// REQ-CORE-009: a rep sees owned + territory records, a manager sees the team, an admin sees everything.
// Scope is computed from tables on every call (no cached grants). Out-of-scope -> forbidden.
import { forbidden } from "./errors";
import { toFilters, type Db, type Row, type Where, type Page } from "./tables";
import type { Principal } from "./me";
import type { TableName } from "./generated/tables";

export const isAdmin = (p: Principal) => p.role === "admin" || p.open_access === true;
export const isManager = (p: Principal) => p.role === "manager";

export function hasPermission(p: Principal, key: string): boolean {
  return isAdmin(p) || p.permissions.includes(key);
}
export function requirePermission(p: Principal, key: string): void {
  if (!hasPermission(p, key)) throw forbidden(`missing permission ${key}`, { permission: key });
}

function ensure(ok: boolean, what: string): void {
  if (!ok) throw forbidden(`${what} is outside your scope`);
}

/** Users whose records the principal may see as "owner or team" (null = everyone). */
export function visibleUserIds(p: Principal): string[] | null {
  if (isAdmin(p)) return null;
  return isManager(p) ? [p.id, ...p.team_user_ids] : [p.id];
}
/** Territories whose accounts the principal may see (null = all). */
export function visibleTerritoryIds(p: Principal): string[] | null {
  if (isAdmin(p)) return null;
  return [...new Set([...p.territory_ids, ...(isManager(p) ? p.team_territory_ids : [])])];
}

// ---- row checks ----------------------------------------------------------------------------
export function canSeeAccount(p: Principal, a: { owner_rep_id?: string | null; territory_id?: string | null }): boolean {
  if (isAdmin(p)) return true;
  const users = visibleUserIds(p)!, terr = visibleTerritoryIds(p)!;
  return (!!a.owner_rep_id && users.includes(a.owner_rep_id)) || (!!a.territory_id && terr.includes(a.territory_id));
}
export const isOwner = (p: Principal, ownerId: string | null | undefined) => isAdmin(p) || (!!ownerId && ownerId === p.id);
export const isOwnerOrTeam = (p: Principal, ownerId: string | null | undefined) => isAdmin(p) || (!!ownerId && visibleUserIds(p)!.includes(ownerId));
/** "team" scope: the target user is in the manager's team (admin: anyone). Reps have no team. */
export const inTeam = (p: Principal, userId: string | null | undefined) => isAdmin(p) || (isManager(p) && !!userId && p.team_user_ids.includes(userId));
export const isApprover = (p: Principal, a: { approver_id?: string | null }) => isAdmin(p) || (!!a.approver_id && a.approver_id === p.id);
export const isRequesterOrApprover = (p: Principal, a: { approver_id?: string | null; requested_by?: string | null }) =>
  isApprover(p, a) || (!!a.requested_by && a.requested_by === p.id);

export const assertOwner = (p: Principal, ownerId: string | null | undefined, what = "record") => ensure(isOwner(p, ownerId), what);
export const assertOwnerOrTeam = (p: Principal, ownerId: string | null | undefined, what = "record") => ensure(isOwnerOrTeam(p, ownerId), what);
export const assertTeam = (p: Principal, userId: string | null | undefined, what = "user") => ensure(inTeam(p, userId), what);
export const assertApprover = (p: Principal, a: { approver_id?: string | null }) => ensure(isApprover(p, a), "approval");
export const assertRequesterOrApprover = (p: Principal, a: { approver_id?: string | null; requested_by?: string | null }) => ensure(isRequesterOrApprover(p, a), "approval");

/** dashboard scope: own for reps, team for managers, all for admin. */
export function dashboardRepIds(p: Principal, requested?: string | null): string[] | null {
  const all = visibleUserIds(p);
  if (requested) { ensure(all === null || all.includes(requested), "rep"); return [requested]; }
  return all;
}

// ---- loaders -------------------------------------------------------------------------------
/** Account by id: not_found if missing / other org, forbidden if out of scope. */
export async function requireAccount(db: Db, p: Principal, accountId: string): Promise<Row<"account">> {
  const a = await db.account.require(accountId);
  ensure(canSeeAccount(p, a), "account");
  return a;
}

type AccountChild = { [N in TableName]: Row<N> extends { account_id: string } ? N : never }[TableName];
/** A row that hangs off an account (contact, deal, task, visit, ...) checked through its account. */
export async function requireAccountRow<N extends AccountChild>(db: Db, p: Principal, table: N, id: string): Promise<Row<N>> {
  const row = await (db[table] as unknown as { require(id: string): Promise<Row<N>> }).require(id);
  await requireAccount(db, p, (row as { account_id: string }).account_id);
  return row;
}

/** OR-of-AND conditions for account visibility, or null for all. */
export function accountScopeWhere(p: Principal): Where<"account">[] | null {
  const users = visibleUserIds(p), terr = visibleTerritoryIds(p);
  if (users === null || terr === null) return null;
  const sets: Where<"account">[] = [{ owner_rep_id: users }];
  if (terr.length) sets.push({ territory_id: terr });
  return sets;
}

/** Accounts visible to the principal, filtered by `where`, ordered by name, paged. */
export async function listAccounts(db: Db, p: Principal, where: Where<"account"> = {}, opts: { limit?: number; offset?: number } = {}): Promise<Page<Row<"account">>> {
  const limit = opts.limit ?? 50, offset = opts.offset ?? 0;
  const sets = accountScopeWhere(p);
  if (!sets) return db.account.list(where, { limit, offset, orderBy: [{ column: "name", direction: "asc" }] });
  // Each scope set is ANDed as raw filters next to the caller's `where`, so a caller condition on the
  // same column (eq or {op}) is kept instead of being overwritten by the scope value.
  const byId = new Map<string, Row<"account">>();
  for (const s of sets) for (const a of await db.account.all(where, { and: toFilters(s) })) byId.set(a.id, a);
  const items = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { items: items.slice(offset, offset + limit), total: items.length };
}
