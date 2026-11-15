// fn:contact-export (contracts/functions/contact-export.json, REQ-SET-004, REQ-CORE-010): GDPR export of one contact:
// the contact row, its activities and the customer messages addressed to it. Human-only: gate gdpr.manage (admin),
// caller mgmt; no agent tool contract references it. One audit_event contact_export (no PII in the detail).
import { defineFunction, notFound, type Impl } from "../../core/src/index";
import { writeAudit } from "./settings-update";

const clean = ({ created_at, updated_at, ...r }: any) => ({ ...r, created_at: created_at ?? null, updated_at: updated_at ?? null });

export function makeImpl(now: () => number = Date.now): Impl<"contact-export"> {
  return async ({ req, db, me }) => {
    const contact = await db.contact.get(req.contact_id);
    const account = contact ? await db.account.get(contact.account_id) : null; // org check: contact has no org_id
    if (!contact || !account) throw notFound("contact not found", { contact_id: req.contact_id });
    const [activities, messages] = await Promise.all([db.activity.all({ contact_id: contact.id }), db.message_approval.all({ contact_id: contact.id })]);
    await writeAudit(db, me, "contact_export", { table: "contact", id: contact.id }, { account_id: account.id, activities: activities.length, messages: messages.length }, now);
    return {
      export: {
        exported_at: new Date(now()).toISOString(), exported_by: me.id,
        contact: clean(contact), account: { id: account.id, name: account.name },
        activities: activities.map(clean), messages: messages.map(clean),
      },
    };
  };
}

export const impl = makeImpl();
/** Wonderful Function entry (functions/contact-export/index.ts calls this). */
export const handle = defineFunction("contact-export", impl);
