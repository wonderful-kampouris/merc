// fn:account-upsert (contracts/functions/account-upsert.json, REQ-CORE-009): human create/edit of an account.
// account_type changes to or from customer go through fn:account-convert (and lost through fn:account-lifecycle),
// so here account_type may only be "prospect" on create and must stay unchanged on edit.
import { canSeeAccount, defineFunction, forbidden, inTeam, invalid, isAdmin, requireAccount, visibleTerritoryIds, type Impl, type Row, type TableInserts } from "../../core/src/index";

/** Columns a human may edit. owner_rep_id is set on create only (later moves go through assignments-transfer). */
export const EDITABLE = ["name", "category_id", "vat_number", "street", "postal_code", "lat", "lng", "phone", "email", "website", "territory_id", "visit_frequency_days", "external_ref"] as const;
export const CREATE_ONLY = ["account_type", "source", "owner_rep_id"] as const;

export const impl: Impl<"account-upsert"> = async ({ req, db, me }) => {
  const fields = req.fields as Record<string, unknown>;
  const creating = !req.account_id;
  const allowed = new Set<string>([...EDITABLE, ...(creating ? CREATE_ONLY : ["account_type"])]);
  const unknown = Object.keys(fields).filter((k) => !allowed.has(k));
  if (unknown.length) throw invalid(`fields not editable here: ${unknown.join(", ")}`, { fields: unknown });

  const current = creating ? null : await requireAccount(db, me, req.account_id!);
  if (current && fields.account_type !== undefined && fields.account_type !== current.account_type)
    throw invalid("account_type changes go through account-convert (prospect to customer) or account-lifecycle (lost)", { field: "account_type" });
  if (creating && fields.account_type !== undefined && fields.account_type !== "prospect")
    throw invalid("a new account starts as a prospect; convert it with account-convert", { field: "account_type" });

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (k !== "account_type" || creating) patch[k] = typeof v === "string" ? v.trim() : v;
  if (patch.name !== undefined && (typeof patch.name !== "string" || !patch.name)) throw invalid("name: required", { field: "name" });

  // Territory: only one the caller works in or manages (admin: any).
  if (patch.territory_id) {
    const terr = visibleTerritoryIds(me);
    if (terr && !terr.includes(patch.territory_id as string)) throw forbidden("territory is outside your scope", { territory_id: patch.territory_id });
  }
  if (creating) {
    if (patch.owner_rep_id && patch.owner_rep_id !== me.id && !inTeam(me, patch.owner_rep_id as string) && !isAdmin(me))
      throw forbidden("you can only create accounts for yourself or your team", { owner_rep_id: patch.owner_rep_id });
    if (!patch.territory_id && patch.postal_code) patch.territory_id = (await db.territory_postal_code.findOne({ postal_code: patch.postal_code as string }))?.territory_id ?? null;
    const row = { account_type: "prospect", source: "manual", owner_rep_id: me.id, territory_id: me.territory_ids[0] ?? null, ...patch, ...(patch.territory_id ? {} : { territory_id: me.territory_ids[0] ?? null }) } as TableInserts["account"];
    if (!canSeeAccount(me, row)) throw forbidden("the new account would be outside your scope");
    const created = await db.account.insert(row);
    return { account_id: created.id, audit: `created ${created.name}` };
  }

  const changed = Object.keys(patch).filter((k) => JSON.stringify((current as unknown as Record<string, unknown>)[k] ?? null) !== JSON.stringify(patch[k] ?? null));
  if (!changed.length) return { account_id: current!.id, audit: null };
  const merged = { ...current!, ...patch } as Row<"account">;
  if (!canSeeAccount(me, merged)) throw forbidden("the change would move the account outside your scope");
  const upd: Record<string, unknown> = {};
  for (const k of changed) upd[k] = patch[k];
  await db.account.update(current!.id, upd as Partial<Row<"account">>);
  return { account_id: current!.id, audit: `updated ${changed.sort().join(", ")}` };
};

/** Wonderful Function entry (functions/account-upsert/index.ts calls this). */
export const handle = defineFunction("account-upsert", impl);
