// fn:territories-list (contracts/functions/territories-list.json, REQ-SET-003): territories with manager, default rep,
// reps and postal codes. Gate territories.read (every role). Reps and managers see all org territories (names and
// coverage are not sensitive); account access stays scoped elsewhere. can_manage tells the UI whether the caller may
// edit the territory (admin: all, manager: the ones they manage).
import { defineFunction, isAdmin, type Impl, type Principal } from "../../core/src/index";

export const canManageTerritory = (me: Principal, t: { manager_id?: string | null }) =>
  isAdmin(me) || (me.role === "manager" && t.manager_id === me.id);

export const impl: Impl<"territories-list"> = async ({ db, me }) => {
  const territories = await db.territory.all();
  const ids = territories.map((t) => t.id);
  const [links, codes, users] = await Promise.all([
    ids.length ? db.territory_rep.all({ territory_id: ids }) : [],
    ids.length ? db.territory_postal_code.all({ territory_id: ids }) : [],
    db.app_user.all(),
  ]);
  const name = new Map(users.map((u) => [u.id, u.full_name]));
  const items = territories
    .map((t) => ({
      id: t.id, name: t.name, manager_id: t.manager_id ?? null, manager_name: t.manager_id ? name.get(t.manager_id) ?? null : null,
      default_rep_id: t.default_rep_id ?? null, default_rep_name: t.default_rep_id ? name.get(t.default_rep_id) ?? null : null,
      boundary_geojson: t.boundary_geojson ?? null,
      reps: links.filter((l) => l.territory_id === t.id).map((l) => ({ id: l.user_id, full_name: name.get(l.user_id) ?? null })),
      postal_codes: codes.filter((c) => c.territory_id === t.id).map((c) => c.postal_code).sort(),
      can_manage: canManageTerritory(me, t),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { items };
};

/** Wonderful Function entry (functions/territories-list/index.ts calls this). */
export const handle = defineFunction("territories-list", impl);
