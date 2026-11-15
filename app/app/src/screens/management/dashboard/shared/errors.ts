import { MercApiError } from "../../../../lib/client";

/** Error-code -> message key in the screen dictionaries (every management screen defines these keys). */
export type ErrorKey = "err.forbidden" | "err.conflict" | "err.validation" | "err.notFound" | "err.timeout" | "err.generic";

export function errorKey(e: unknown): ErrorKey {
  if (e instanceof MercApiError) {
    switch (e.code) {
      case "forbidden":
        return "err.forbidden";
      case "conflict":
        return "err.conflict";
      case "validation_failed":
        return "err.validation";
      case "not_found":
        return "err.notFound";
      case "timeout":
        return "err.timeout";
      default:
        return "err.generic";
    }
  }
  return "err.generic";
}

export const errorDetail = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Strings every management screen dictionary carries, so the shared region can render states. */
export const COMMON_EN = {
  retry: "Try again",
  "err.forbidden": "You do not have access to this data.",
  "err.conflict": "This clashes with an existing record.",
  "err.validation": "Some values are not valid.",
  "err.notFound": "Not found.",
  "err.timeout": "The server took too long. Try again.",
  "err.generic": "Could not load the data.",
  "mock.note": "Mock data from the contracts",
} as const;

export const COMMON_EL: Record<keyof typeof COMMON_EN, string> = {
  retry: "Δοκιμάστε ξανά",
  "err.forbidden": "Δεν έχετε πρόσβαση σε αυτά τα δεδομένα.",
  "err.conflict": "Συγκρούεται με υπάρχουσα εγγραφή.",
  "err.validation": "Κάποιες τιμές δεν είναι έγκυρες.",
  "err.notFound": "Δεν βρέθηκε.",
  "err.timeout": "Ο διακομιστής άργησε. Δοκιμάστε ξανά.",
  "err.generic": "Δεν ήταν δυνατή η φόρτωση των δεδομένων.",
  "mock.note": "Δοκιμαστικά δεδομένα από τα συμβόλαια",
};
