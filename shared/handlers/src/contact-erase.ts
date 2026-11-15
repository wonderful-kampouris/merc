// fn:contact-erase (contracts/functions/contact-erase.json, REQ-SET-004, REQ-CORE-010): GDPR erase of one contact.
// Human-only (gate gdpr.manage, caller mgmt, no agent tool may call it). confirm must be true, else
// needs_confirmation. Deletes the contact row; activity.contact_id and message_approval.contact_id are set null by
// the FK rules. One audit_event contact_erase whose detail holds no PII (ids and counts only).
import { defineFunction, needsConfirmation, notFound, type Impl } from "../../core/src/index";
import { writeAudit } from "./settings-update";

export function makeImpl(now: () => number = Date.now): Impl<"contact-erase"> {
  return async ({ req, db, me }) => {
    const contact = await db.contact.get(req.contact_id);
    const account = contact ? await db.account.get(contact.account_id) : null;
    if (!contact || !account) throw notFound("contact not found", { contact_id: req.contact_id });
    if (req.confirm !== true) throw needsConfirmation("erasing a contact cannot be undone: resend with confirm=true", { contact_id: contact.id });
    const [activities, messages] = await Promise.all([db.activity.count({ contact_id: contact.id }), db.message_approval.count({ contact_id: contact.id })]);
    await db.contact.delete(contact.id);
    await writeAudit(db, me, "contact_erase", { table: "contact", id: contact.id }, { account_id: account.id, activities_unlinked: activities, messages_unlinked: messages }, now);
    return { erased: true };
  };
}

export const impl = makeImpl();
/** Wonderful Function entry (functions/contact-erase/index.ts calls this). */
export const handle = defineFunction("contact-erase", impl);
