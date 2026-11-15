// fn:users-list (contracts/functions/users-list.json, REQ-SET-002): every user of the org with role, manager and
// territories, for the admin Users screen. Gate users.manage (admin). Invite state: a user whose Wonderful user id
// is still the user-upsert placeholder (`invite:<email>`) shows invite_pending=true.
import { defineFunction, type Impl } from "../../core/src/index";

export const INVITE_PREFIX = "invite:";

export const impl: Impl<"users-list"> = async ({ db }) => {
  const [users, roles, links, territories] = await Promise.all([db.app_user.all(), db.role.all(), db.territory_rep.all(), db.territory.all()]);
  const roleName = new Map(roles.map((r) => [r.code, r.name]));
  const terrName = new Map(territories.map((t) => [t.id, t.name]));
  const userName = new Map(users.map((u) => [u.id, u.full_name]));
  const items = users
    .map((u) => {
      const tids = links.filter((l) => l.user_id === u.id && terrName.has(l.territory_id)).map((l) => l.territory_id);
      return {
        id: u.id, full_name: u.full_name, email: u.email, phone: u.phone ?? null, role_code: u.role_code,
        role_name: roleName.get(u.role_code) ?? u.role_code, manager_id: u.manager_id ?? null,
        manager_name: u.manager_id ? userName.get(u.manager_id) ?? null : null, status: u.status,
        preferred_language: u.preferred_language ?? null, voice_enabled: u.voice_enabled,
        territory_ids: tids, territories: tids.map((id) => ({ id, name: terrName.get(id)! })),
        invite_pending: String(u.wonderful_user_id ?? "").startsWith(INVITE_PREFIX),
      };
    })
    .sort((a, b) => (a.status === b.status ? a.full_name.localeCompare(b.full_name) : a.status === "active" ? -1 : 1));
  return { items };
};

/** Wonderful Function entry (functions/users-list/index.ts calls this). */
export const handle = defineFunction("users-list", impl);
