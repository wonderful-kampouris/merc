import { lazy } from "react";
import { checkScreenMessages, registerScreenMessages, type ScreenMessages } from "../lib/i18n";
import { SCREENS } from "../lib/routes";
import { buildRegistry, folderOfPath, type ScreenLoader } from "../lib/screenRegistry";

/**
 * Route -> screen module. Every app.json route maps to `./<shell>/<screen>/index.tsx` when that file exists
 * (loaded lazily, its own chunk), else to the shell's placeholder. Folders: `rep/<key>`, `management/<key>`
 * with the screen keys of contracts/app/app.json (e.g. `rep/new_shops`, `management/gdpr`).
 * Contract for screen packages: ./README.md.
 */
const modules = import.meta.glob<Awaited<ReturnType<ScreenLoader>>>("./*/*/index.tsx");

/** Per-screen dictionaries are small, so they load eagerly: titles and toggles never wait on a chunk. */
const dictionaries = import.meta.glob<ScreenMessages>("./*/*/i18n.ts", { eager: true, import: "default" });
for (const [path, m] of Object.entries(dictionaries)) {
  const folder = folderOfPath(path, "i18n.ts");
  if (!folder || !m) continue;
  const problems = checkScreenMessages(m);
  if (problems.length) console.warn(`[merc] screens/${folder}/i18n.ts: ${problems.join("; ")}`);
  registerScreenMessages(folder, m);
}

const Placeholder = lazy(() => import("../shell/PlaceholderScreen"));

export const screenRegistry = buildRegistry(SCREENS, modules as Record<string, ScreenLoader>, Placeholder);
if (screenRegistry.orphans.length) {
  console.warn(`[merc] screen folders with no app.json route: ${screenRegistry.orphans.join(", ")}`);
}
