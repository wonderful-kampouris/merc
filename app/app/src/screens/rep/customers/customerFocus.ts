import { readStored, writeStored } from "../../../lib/storage";

/**
 * The account whose visit card is open on the Customers screen, also used as the hand-off from Today's stops.
 * Kept in sessionStorage because navigation between screens carries only a route. It is read without clearing,
 * so a remount (language switch, route re-render) keeps the card open; Back to list clears it.
 */
export const CUSTOMER_FOCUS_KEY = "merc.customers.focus";

export function setCustomerFocus(accountId: string): void {
  writeStored(CUSTOMER_FOCUS_KEY, accountId, "session");
}

/** The account to open, if any. */
export function peekCustomerFocus(): string | null {
  return readStored(CUSTOMER_FOCUS_KEY, "session");
}

/** Back to the list: a later visit to Customers starts at the list. */
export function clearCustomerFocus(): void {
  writeStored(CUSTOMER_FOCUS_KEY, null, "session");
}
