import type { Lang } from "../../../lib/i18n";
import { isObj, isUuid, type Obj } from "../settings/kit";

export { isUuid };

/** The word the admin must type before an erase: a typed confirmation, on top of the dialog (REQ-SET-004). */
export const ERASE_WORD: Record<Lang, string> = { el: "ΔΙΑΓΡΑΦΗ", en: "ERASE" };

/** Typed confirmation accepted in either language, case- and accent-insensitive. */
export function eraseConfirmed(typed: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").trim().toUpperCase();
  const v = norm(typed);
  return v.length > 0 && Object.values(ERASE_WORD).some((w) => norm(w) === v);
}

export const exportFilename = (contactId: string, now: Date = new Date()): string =>
  `contact-${contactId.slice(0, 8)}-${now.toISOString().slice(0, 10)}.json`;

/** Top-level sections of the export with their record counts, for the summary row. */
export function exportSummary(exp: Obj): { key: string; count: number }[] {
  return Object.entries(exp).map(([key, v]) => ({ key, count: Array.isArray(v) ? v.length : isObj(v) ? 1 : v == null ? 0 : 1 }));
}

export const exportJson = (exp: Obj): string => JSON.stringify(exp, null, 2);
