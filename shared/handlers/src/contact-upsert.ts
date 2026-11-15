// fn:contact-upsert (contracts/functions/contact-upsert.json, REQ-CORE-009): create or edit a contact of a visible account.
import { defineFunction, invalid, requireAccount, requireAccountRow, type Impl, type Row, type TableInserts } from "../../core/src/index";

export const EDITABLE = ["full_name", "role_title", "phone", "email", "is_decision_maker", "preferred_channel"] as const;

export const impl: Impl<"contact-upsert"> = async ({ req, db, me }) => {
  const fields = req.fields as Record<string, unknown>;
  const unknown = Object.keys(fields).filter((k) => !(EDITABLE as readonly string[]).includes(k));
  if (unknown.length) throw invalid(`fields not editable here: ${unknown.join(", ")}`, { fields: unknown });
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) patch[k] = typeof v === "string" ? v.trim() : v;
  if (patch.full_name !== undefined && (typeof patch.full_name !== "string" || !patch.full_name)) throw invalid("full_name: required", { field: "full_name" });

  const account = await requireAccount(db, me, req.account_id);
  if (req.contact_id) {
    const contact = await requireAccountRow(db, me, "contact", req.contact_id);
    if (contact.account_id !== account.id) throw invalid("contact belongs to another account", { contact_id: contact.id });
    if (Object.keys(patch).length) await db.contact.update(contact.id, patch as Partial<Row<"contact">>);
    return { contact_id: contact.id };
  }
  const created = await db.contact.insert({ is_decision_maker: false, ...patch, account_id: account.id } as TableInserts["contact"]);
  return { contact_id: created.id };
};

/** Wonderful Function entry (functions/contact-upsert/index.ts calls this). */
export const handle = defineFunction("contact-upsert", impl);
