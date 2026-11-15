// fn:territory-upsert (contracts/functions/territory-upsert.json, REQ-SET-003, REQ-CORE-010): create or edit a
// territory, its reps (rep_ids replaces the territory_rep set) and postal codes (replaces the set). A postal code
// belongs to one territory only: a code held by another territory is a conflict naming it. Admin: any territory.
// Manager (territories.manage, team_manager): only territories they manage, reps/default rep from their team, and
// they stay the manager. One audit_event settings_change.
import { conflict, defineFunction, forbidden, inTeam, invalid, isAdmin, notFound, type Db, type Impl, type UserPrincipal } from "../../core/src/index";
import { writeAudit } from "./settings-update";
import { canManageTerritory } from "./territories-list";

async function requireOrgUser(db: Db, me: UserPrincipal, id: string, what: string) {
  const u = await db.app_user.get(id);
  if (!u || u.status !== "active") throw invalid(`${what} must be an active user of this organization`, { user_id: id });
  if (!isAdmin(me) && id !== me.id && !inTeam(me, id)) throw forbidden(`${what} is outside your team`, { user_id: id });
  return u;
}

export function makeImpl(now: () => number = Date.now): Impl<"territory-upsert"> {
  return async ({ req, db, me }) => {
    const name = req.name.trim();
    if (!name) throw invalid("name is required");
    const current = req.territory_id ? await db.territory.get(req.territory_id) : null;
    if (req.territory_id && !current) throw notFound("territory not found", { territory_id: req.territory_id });
    if (current && !canManageTerritory(me, current)) throw forbidden("you do not manage this territory", { territory_id: current.id });

    let managerId = req.manager_id ?? null;
    if (!isAdmin(me)) {
      if (managerId && managerId !== me.id) throw forbidden("a manager cannot hand a territory to another manager");
      managerId = me.id;
    }
    if (managerId) {
      const m = await db.app_user.get(managerId);
      if (!m || m.status !== "active" || !["manager", "admin"].includes(m.role_code)) throw invalid("manager_id must be an active manager or admin", { manager_id: managerId });
    }
    const repIds = [...new Set(req.rep_ids)];
    for (const id of repIds) await requireOrgUser(db, me, id, "rep");
    if (req.default_rep_id) {
      await requireOrgUser(db, me, req.default_rep_id, "default rep");
      if (!repIds.includes(req.default_rep_id)) repIds.push(req.default_rep_id);
    }
    const codes = [...new Set(req.postal_codes.map((c) => c.trim()).filter(Boolean))];
    for (const code of codes) {
      if (!(await db.postal_area.get(code))) throw invalid(`unknown postal code ${code}`, { postal_code: code });
      const held = await db.territory_postal_code.findOne({ postal_code: code });
      if (held && held.territory_id !== current?.id) {
        const other = await db.territory.get(held.territory_id);
        throw conflict(`postal code ${code} already belongs to ${other?.name ?? "another territory"}`, { postal_code: code, territory_id: held.territory_id });
      }
    }

    const fields = { name, manager_id: managerId, default_rep_id: req.default_rep_id ?? null, ...(req.boundary_geojson !== undefined ? { boundary_geojson: req.boundary_geojson } : {}) };
    const t = current ? await db.territory.update(current.id, fields as any) : await db.territory.insert(fields as any);

    const links = await db.territory_rep.all({ territory_id: t.id });
    for (const l of links) if (!repIds.includes(l.user_id)) await db.territory_rep.delete(l.id);
    for (const id of repIds) if (!links.some((l) => l.user_id === id)) await db.territory_rep.insert({ territory_id: t.id, user_id: id } as any);

    const held = await db.territory_postal_code.all({ territory_id: t.id });
    for (const c of held) if (!codes.includes(c.postal_code)) await db.territory_postal_code.delete(c.id);
    for (const code of codes) if (!held.some((c) => c.postal_code === code)) await db.territory_postal_code.insert({ territory_id: t.id, postal_code: code } as any);

    await writeAudit(db, me, "settings_change", { table: "territory", id: t.id },
      { op: current ? "territory_update" : "territory_create", name, manager_id: managerId, default_rep_id: req.default_rep_id ?? null, rep_ids: repIds, postal_codes: codes }, now);
    return { territory_id: t.id };
  };
}

export const impl = makeImpl();
/** Wonderful Function entry (functions/territory-upsert/index.ts calls this). */
export const handle = defineFunction("territory-upsert", impl);
