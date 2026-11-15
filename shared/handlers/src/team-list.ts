// fn:team-list (contracts/functions/team-list.json). Gate team.read, scope team.
// Roster for manager screens: the caller's direct and indirect reports plus the reps of territories they manage;
// an admin sees every user of the org. Inactive users (status left) only with include_inactive.
// Each row: UserRef, manager_id, the territories the user works in (tbl:territory_rep) and status.
import { defineFunction, forbidden, isAdmin, isManager, type Impl } from "../../core/src/index";
import { inChunks } from "./metrics-rollup";
import { userRef } from "./dashboard-kpis";

export const impl: Impl<"team-list"> = async ({ req, db, me }) => {
  if (!isAdmin(me) && !isManager(me)) throw forbidden("the team roster is for managers and admins");
  const users = await db.app_user.all();
  const byId = new Map(users.map((u) => [u.id, u]));
  // tbl:territory_rep has no org_id: read it through the org's territories.
  const territories = await db.territory.all();
  const links = await inChunks(territories.map((t) => t.id), (c) => db.territory_rep.all({ territory_id: c }));
  let ids: Set<string>;
  if (isAdmin(me)) ids = new Set(users.map((u) => u.id));
  else {
    const managed = new Set(territories.filter((t) => t.manager_id === me.id).map((t) => t.id));
    ids = new Set([...me.team_user_ids, ...links.filter((l) => managed.has(l.territory_id)).map((l) => l.user_id)]);
    ids.delete(me.id);
  }
  const terrOf = new Map<string, string[]>();
  for (const l of links) (terrOf.get(l.user_id) ?? terrOf.set(l.user_id, []).get(l.user_id)!).push(l.territory_id);
  const items = [...ids]
    .map((id) => byId.get(id))
    .filter((u): u is NonNullable<typeof u> => !!u && (req.include_inactive === true || u.status === "active"))
    .sort((a, b) => a.full_name.localeCompare(b.full_name) || a.id.localeCompare(b.id))
    .map((u) => ({ user: userRef(u), manager_id: u.manager_id ?? null, territory_ids: [...new Set(terrOf.get(u.id) ?? [])].sort(), status: u.status }));
  return { items };
};

/** Wonderful Function entry (functions/team-list/index.ts calls this). */
export const handle = defineFunction("team-list", impl);
