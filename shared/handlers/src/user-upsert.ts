// fn:user-upsert (contracts/functions/user-upsert.json, REQ-SET-002, REQ-CORE-010): invite or edit a Merc user.
// New user: app_user row with wonderful_user_id = `invite:<email>` until the person accepts the workspace invite
// (workspace members get the app's default role "rep", so an invited rep gets the Rep app). invited=true.
// Existing user (user_id): role, manager, name, phone, status and territories change. territory_ids replaces the
// user's territory_rep set. Rules: email unique in the org; manager must be an active manager/admin of the org and
// not the user; an admin cannot demote or deactivate themselves. One audit_event user_change.
import { conflict, defineFunction, invalid, notFound, type Db, type Impl } from "../../core/src/index";
import { writeAudit } from "./settings-update";
import { INVITE_PREFIX } from "./users-list";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function syncTerritoryLinks(db: Db, userId: string, territoryIds: string[]) {
  const want = new Set(territoryIds);
  for (const id of want) if (!(await db.territory.get(id))) throw invalid("unknown territory", { territory_id: id });
  const cur = await db.territory_rep.all({ user_id: userId });
  for (const l of cur) if (!want.has(l.territory_id)) await db.territory_rep.delete(l.id);
  const have = new Set(cur.map((l) => l.territory_id));
  for (const id of want) if (!have.has(id)) await db.territory_rep.insert({ territory_id: id, user_id: userId } as any);
}

export function makeImpl(now: () => number = Date.now): Impl<"user-upsert"> {
  return async ({ req, db, me }) => {
    const email = req.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw invalid("email is not valid", { email: req.email });
    const full_name = req.full_name.trim();
    if (!full_name) throw invalid("full_name is required");
    const current = req.user_id ? await db.app_user.get(req.user_id) : null;
    if (req.user_id && !current) throw notFound("user not found", { user_id: req.user_id });

    const clash = (await db.app_user.all()).find((u) => u.email.trim().toLowerCase() === email && u.id !== current?.id);
    if (clash) throw conflict(`${email} is already a Merc user`, { user_id: clash.id });

    if (req.manager_id) {
      if (req.manager_id === current?.id) throw invalid("a user cannot be their own manager");
      const m = await db.app_user.get(req.manager_id);
      if (!m || m.status !== "active" || !["manager", "admin"].includes(m.role_code)) throw invalid("manager must be an active manager or admin", { manager_id: req.manager_id });
    }
    if (current?.id === me.id && (req.role_code !== "admin" || req.status === "left")) throw invalid("you cannot demote or deactivate yourself");

    const fields = {
      email, full_name, role_code: req.role_code, manager_id: req.manager_id ?? null,
      ...(req.phone !== undefined ? { phone: req.phone } : {}),
      ...(req.status ? { status: req.status } : {}),
    };
    let userId: string, invited = false;
    if (current) {
      await db.app_user.update(current.id, fields as any);
      userId = current.id;
    } else {
      const row = await db.app_user.insert({ ...fields, wonderful_user_id: `${INVITE_PREFIX}${email}`, voice_enabled: true, status: req.status ?? "active" } as any);
      userId = row.id; invited = true;
    }
    await syncTerritoryLinks(db, userId, req.territory_ids);
    const before = current ? { role_code: current.role_code, manager_id: current.manager_id ?? null, status: current.status } : null;
    await writeAudit(db, me, "user_change", { table: "app_user", id: userId },
      { op: current ? "update" : "invite", before, after: { role_code: req.role_code, manager_id: req.manager_id ?? null, status: req.status ?? (current?.status ?? "active"), territory_ids: req.territory_ids } }, now);
    return { user_id: userId, invited };
  };
}

export const impl = makeImpl();
/** Wonderful Function entry (functions/user-upsert/index.ts calls this). */
export const handle = defineFunction("user-upsert", impl);
