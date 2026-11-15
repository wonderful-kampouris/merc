import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { MercClient } from "./client";
import type { Lang } from "./i18n";
import type { SocketLike } from "./live";
import type { Screen } from "./routes";

/**
 * Props every screen module receives (see src/screens/README.md).
 * `client` is `client.forScreen(screen.functions)`: calls outside the screen's app.json list fail with `forbidden`.
 */
export interface ScreenProps {
  screen: Screen;
  client: MercClient;
  /** Opens fn:merc-live for this shell; undefined in mock mode (useLive then polls). */
  openLiveSocket?: () => SocketLike;
  navigate: (route: string) => void;
  lang: Lang;
}

export interface ScreenModule {
  default: ComponentType<ScreenProps>;
}
export type ScreenLoader = () => Promise<ScreenModule>;

export interface RegistryEntry {
  screen: Screen;
  /** `<shell>/<screen key>` under src/screens, e.g. `rep/new_shops`. */
  folder: string;
  /** True when src/screens/<folder>/index.tsx exists. */
  implemented: boolean;
  load?: ScreenLoader;
}

export interface ScreenRegistry {
  entries: readonly RegistryEntry[];
  /** Screen folders with an index.tsx that match no app.json route (typo or stale folder). */
  orphans: readonly string[];
  entry(route: string): RegistryEntry | undefined;
  /** Stable lazy component for a route: the screen module, or the placeholder when the folder has none. */
  component(screen: Screen): ComponentType<ScreenProps>;
}

export const screenFolder = (s: Pick<Screen, "shell" | "key">): string => `${s.shell}/${s.key}`;

/** `./rep/today/index.tsx` (any prefix) -> `rep/today`; null for anything that is not `<shell>/<screen>/<file>`. */
export function folderOfPath(path: string, file = "index.tsx"): string | null {
  const m = new RegExp(`(?:^|/)([a-z_]+)/([a-z0-9_]+)/${file.replace(".", "\\.")}$`).exec(path);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Build the route -> screen module map.
 * `modules` is an `import.meta.glob("./<shell>/<screen>/index.tsx")` result (path -> loader).
 */
export function buildRegistry(
  screens: readonly Screen[],
  modules: Record<string, ScreenLoader>,
  placeholder: ComponentType<ScreenProps>,
): ScreenRegistry {
  const byFolder = new Map<string, ScreenLoader>();
  for (const [path, load] of Object.entries(modules)) {
    const f = folderOfPath(path);
    if (f) byFolder.set(f, load);
  }
  const entries: RegistryEntry[] = screens.map((screen) => {
    const folder = screenFolder(screen);
    const load = byFolder.get(folder);
    return { screen, folder, implemented: !!load, load };
  });
  const known = new Set(entries.map((e) => e.folder));
  const orphans = [...byFolder.keys()].filter((f) => !known.has(f)).sort();
  const components = new Map<string, LazyExoticComponent<ComponentType<ScreenProps>>>();
  const byRoute = new Map(entries.map((e) => [e.screen.route, e]));

  return {
    entries,
    orphans,
    entry: (route) => byRoute.get(route),
    component(screen) {
      const e = byRoute.get(screen.route);
      if (!e?.load) return placeholder;
      let c = components.get(e.folder);
      if (!c) {
        const load = e.load;
        c = lazy(async () => {
          const mod = await load();
          if (typeof mod?.default !== "function" && typeof mod?.default !== "object") {
            throw new Error(`screens/${e.folder}/index.tsx has no default export component`);
          }
          return mod;
        });
        components.set(e.folder, c);
      }
      return c;
    },
  };
}
