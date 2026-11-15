import { defineScreenMessages } from "../../../../lib/i18n";

/** Strings of the shared kit (loading / error / feedback views). Screen-specific strings live in each i18n.ts. */
export default defineScreenMessages({
  en: {
    "kit.retry": "Try again",
    "kit.loadError": "Couldn't load this",
    "kit.refreshing": "Updating…",
    "kit.close": "Close",
    "err.not_found": "Not found. It may have been removed.",
    "err.forbidden": "You don't have access to this.",
    "err.validation_failed": "Some details are not valid.",
    "err.needs_confirmation": "This needs your confirmation first.",
    "err.conflict": "This was already changed. Refresh and try again.",
    "err.upstream_failed": "The service is not available right now.",
    "err.timeout": "It took too long. Try again.",
    "err.blocked_by_policy": "Not allowed by company policy.",
    "err.unknown": "Something went wrong.",
  },
  el: {
    "kit.retry": "Δοκιμή ξανά",
    "kit.loadError": "Δεν ήταν δυνατή η φόρτωση",
    "kit.refreshing": "Ενημέρωση…",
    "kit.close": "Κλείσιμο",
    "err.not_found": "Δεν βρέθηκε. Ίσως έχει αφαιρεθεί.",
    "err.forbidden": "Δεν έχετε πρόσβαση σε αυτό.",
    "err.validation_failed": "Κάποια στοιχεία δεν είναι έγκυρα.",
    "err.needs_confirmation": "Χρειάζεται πρώτα την επιβεβαίωσή σας.",
    "err.conflict": "Έχει ήδη αλλάξει. Ανανεώστε και δοκιμάστε ξανά.",
    "err.upstream_failed": "Η υπηρεσία δεν είναι διαθέσιμη αυτή τη στιγμή.",
    "err.timeout": "Άργησε πολύ. Δοκιμάστε ξανά.",
    "err.blocked_by_policy": "Δεν επιτρέπεται από την πολιτική της εταιρείας.",
    "err.unknown": "Κάτι πήγε στραβά.",
  },
});
