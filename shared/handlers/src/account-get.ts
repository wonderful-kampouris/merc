// fn:account-get (contracts/functions/account-get.json, REQ-CORE-009): one account with contacts, deals and recent activity.
import { defineFunction, requireAccount, type Impl } from "../../core/src/index";

export const ACTIVITY_LIMIT = 50;
const plain = (r: object): Record<string, unknown> => ({ ...(r as Record<string, unknown>) });

export const impl: Impl<"account-get"> = async ({ req, db, me }) => {
  const account = await requireAccount(db, me, req.account_id);
  const [contacts, deals, activities] = await Promise.all([
    db.contact.all({ account_id: account.id }, { orderBy: [{ column: "full_name", direction: "asc" }] }),
    db.deal.all({ account_id: account.id }, { orderBy: [{ column: "expected_close_date", direction: "asc" }] }),
    db.activity.list({ account_id: account.id }, { limit: ACTIVITY_LIMIT, orderBy: [{ column: "occurred_at", direction: "desc" }] }),
  ]);
  return { account: plain(account), contacts: contacts.map(plain), deals: deals.map(plain), activities: activities.items.map(plain) };
};

/** Wonderful Function entry (functions/account-get/index.ts calls this). */
export const handle = defineFunction("account-get", impl);
