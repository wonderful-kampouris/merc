import { createContext, createElement, useContext, type ReactNode } from "react";
import { readStored, writeStored } from "./storage";

export type Lang = "el" | "en";
export const LANGS: readonly Lang[] = ["el", "en"];
export const DEFAULT_LANG: Lang = "el";
const LANG_KEY = "merc.lang";

const en = {
  "app.title": "Merc",
  "shell.rep": "Rep",
  "shell.management": "Management",
  "role.rep": "Rep",
  "role.manager": "Manager",
  "role.admin": "Admin",
  "top.language": "Language",
  "top.shell": "Workspace",
  "top.role": "Role (mock)",
  "top.mock": "Mock data",
  "nav.more": "More",
  "nav.main": "Main navigation",
  "screen.rep.today": "Today",
  "screen.rep.customers": "Customers",
  "screen.rep.record": "Record",
  "screen.rep.approvals": "Approvals",
  "screen.rep.alerts": "Alerts",
  "screen.rep.new_shops": "New shops",
  "screen.rep.week": "Week",
  "screen.rep.ai_log": "AI log",
  "screen.management.dashboard": "Dashboard",
  "screen.management.team": "Team",
  "screen.management.approvals": "Approvals",
  "screen.management.pipeline": "Pipeline",
  "screen.management.territories": "Territories",
  "screen.management.campaigns": "Campaigns",
  "screen.management.targets": "Targets",
  "screen.management.competition": "Competition",
  "screen.management.settings": "Settings",
  "screen.management.users": "Users",
  "screen.management.import": "Import",
  "screen.management.gdpr": "GDPR",
  "screen.management.ai_log": "AI log",
  "placeholder.title": "Coming soon",
  "placeholder.body": "This screen is a placeholder. It will use the functions below.",
  "placeholder.functions": "Functions",
  "placeholder.events": "Live events",
  "placeholder.sample": "Try a sample call",
  "placeholder.noSample": "No function here can be called without input.",
  "badge.offline": "Works offline",
  "badge.mock": "Mock",
  "live.connecting": "Connecting…",
  "live.socket": "Live",
  "live.polling": "Polling",
  "live.off": "Offline",
  "common.loading": "Loading…",
  "common.error": "Something went wrong",
} as const;

export type MessageKey = keyof typeof en;

const el: Record<MessageKey, string> = {
  "app.title": "Merc",
  "shell.rep": "Πωλητής",
  "shell.management": "Διοίκηση",
  "role.rep": "Πωλητής",
  "role.manager": "Διευθυντής",
  "role.admin": "Διαχειριστής",
  "top.language": "Γλώσσα",
  "top.shell": "Χώρος",
  "top.role": "Ρόλος (δοκιμή)",
  "top.mock": "Δοκιμαστικά δεδομένα",
  "nav.more": "Περισσότερα",
  "nav.main": "Κύρια πλοήγηση",
  "screen.rep.today": "Σήμερα",
  "screen.rep.customers": "Πελάτες",
  "screen.rep.record": "Καταγραφή",
  "screen.rep.approvals": "Εγκρίσεις",
  "screen.rep.alerts": "Ειδοποιήσεις",
  "screen.rep.new_shops": "Νέα καταστήματα",
  "screen.rep.week": "Εβδομάδα",
  "screen.rep.ai_log": "Ιστορικό AI",
  "screen.management.dashboard": "Πίνακας ελέγχου",
  "screen.management.team": "Ομάδα",
  "screen.management.approvals": "Εγκρίσεις",
  "screen.management.pipeline": "Ευκαιρίες",
  "screen.management.territories": "Περιοχές",
  "screen.management.campaigns": "Καμπάνιες",
  "screen.management.targets": "Στόχοι",
  "screen.management.competition": "Ανταγωνισμός",
  "screen.management.settings": "Ρυθμίσεις",
  "screen.management.users": "Χρήστες",
  "screen.management.import": "Εισαγωγή",
  "screen.management.gdpr": "GDPR",
  "screen.management.ai_log": "Ιστορικό AI",
  "placeholder.title": "Έρχεται σύντομα",
  "placeholder.body": "Αυτή η οθόνη είναι προσωρινή. Θα χρησιμοποιεί τις παρακάτω λειτουργίες.",
  "placeholder.functions": "Λειτουργίες",
  "placeholder.events": "Ζωντανά γεγονότα",
  "placeholder.sample": "Δοκιμαστική κλήση",
  "placeholder.noSample": "Καμία λειτουργία εδώ δεν καλείται χωρίς δεδομένα.",
  "badge.offline": "Λειτουργεί χωρίς σύνδεση",
  "badge.mock": "Δοκιμή",
  "live.connecting": "Σύνδεση…",
  "live.socket": "Ζωντανά",
  "live.polling": "Ανανέωση",
  "live.off": "Χωρίς σύνδεση",
  "common.loading": "Φόρτωση…",
  "common.error": "Κάτι πήγε στραβά",
};

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { el, en };

export const translate = (lang: Lang, key: MessageKey): string => MESSAGES[lang][key] ?? MESSAGES.en[key] ?? key;
export const isMessageKey = (k: string): k is MessageKey => k in en;

/** Greek unless the user picked English before (REQ-APP-005). The host UI language is not used: Greek is the product default. */
export function initialLang(): Lang {
  const stored = readStored(LANG_KEY);
  return stored === "en" || stored === "el" ? stored : DEFAULT_LANG;
}
export const storeLang = (lang: Lang): void => writeStored(LANG_KEY, lang);

export type Translate = (key: MessageKey) => string;
const I18nContext = createContext<{ lang: Lang; t: Translate }>({ lang: DEFAULT_LANG, t: (k) => translate(DEFAULT_LANG, k) });

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return createElement(I18nContext.Provider, { value: { lang, t: (k: MessageKey) => translate(lang, k) } }, children);
}
export const useI18n = () => useContext(I18nContext);
/* ---------- Per-screen dictionaries (one i18n.ts per screen folder, see src/screens/README.md) ---------- */

/** A screen's own strings: English is the key set, Greek must cover the same keys. */
export interface ScreenMessages<K extends string = string> {
  en: Readonly<Record<K, string>>;
  el: Readonly<Record<K, string>>;
}

/** Typed helper for `src/screens/<shell>/<screen>/i18n.ts`: `export default defineScreenMessages({ en: {...}, el: {...} })`. */
export function defineScreenMessages<const E extends Record<string, string>>(m: {
  en: E;
  el: Record<keyof E & string, string>;
}): ScreenMessages<keyof E & string> {
  return m as ScreenMessages<keyof E & string>;
}

/** Problems with a screen dictionary: keys missing in one language or empty strings. Empty list = valid. */
export function checkScreenMessages(m: ScreenMessages): string[] {
  const out: string[] = [];
  for (const lang of LANGS) {
    const other = lang === "el" ? "en" : "el";
    for (const [k, v] of Object.entries(m[lang] ?? {})) {
      if (!(k in (m[other] ?? {}))) out.push(`${k}: missing in ${other}`);
      if (typeof v !== "string" || !v.trim()) out.push(`${k}: empty in ${lang}`);
    }
  }
  return out;
}

const screenDicts = new Map<string, ScreenMessages>();

/** Register a screen folder's dictionary (done by src/screens/registry.ts for every `i18n.ts`). */
export function registerScreenMessages(folder: string, m: ScreenMessages): void {
  screenDicts.set(folder, m);
}
export const registeredScreenMessages = (): ReadonlyMap<string, ScreenMessages> => screenDicts;

export type Vars = Readonly<Record<string, string | number>>;
const fill = (s: string, vars?: Vars): string =>
  vars ? s.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all)) : s;

/** Screen string lookup: screen dict (lang, then en), then the app-wide dictionary, then the key itself. `{name}` placeholders are filled from vars. */
export function translateScreen(m: ScreenMessages | undefined, lang: Lang, key: string, vars?: Vars): string {
  const own = m?.[lang]?.[key] ?? m?.en?.[key];
  if (own !== undefined) return fill(own, vars);
  return fill(isMessageKey(key) ? translate(lang, key) : key, vars);
}

/**
 * Hook for screens: `const { t, lang } = useScreenI18n(messages)` with the folder's i18n.ts default export.
 * `t` accepts the screen's own keys and the app-wide keys (common.loading, ...); it follows the language toggle.
 */
export function useScreenI18n<K extends string>(m: ScreenMessages<K>) {
  const { lang } = useI18n();
  const t = (key: K | MessageKey, vars?: Vars): string => translateScreen(m as ScreenMessages, lang, key, vars);
  return { t, lang };
}

export const screenTitleKey = (shell: string, key: string): MessageKey => {
  const k = `screen.${shell}.${key}`;
  return isMessageKey(k) ? k : "app.title";
};
