import { describe, expect, it } from "vitest";
import appContract from "../contracts/app.json";
import { screenRegistry } from "../screens/registry";
import { registeredScreenMessages, checkScreenMessages } from "./i18n";
import { SCREENS } from "./routes";
import { buildRegistry, folderOfPath, screenFolder, type ScreenModule, type ScreenProps } from "./screenRegistry";

const Placeholder = (_: ScreenProps) => null;
const Today = (_: ScreenProps) => null;

describe("screen registry (route -> lazy screen module, placeholder fallback)", () => {
  it("parses screen folder paths", () => {
    expect(folderOfPath("./rep/today/index.tsx")).toBe("rep/today");
    expect(folderOfPath("/src/screens/management/gdpr/index.tsx")).toBe("management/gdpr");
    expect(folderOfPath("./rep/new_shops/i18n.ts", "i18n.ts")).toBe("rep/new_shops");
    expect(folderOfPath("./rep/today/Card.tsx")).toBeNull();
    expect(folderOfPath("./today/index.tsx")).toBeNull();
  });

  it("maps a route to its folder module when present, else the placeholder", async () => {
    let loads = 0;
    const reg = buildRegistry(
      SCREENS,
      {
        "./rep/today/index.tsx": async () => {
          loads++;
          return { default: Today } as ScreenModule;
        },
        "./rep/nope/index.tsx": async () => ({ default: Today }),
      },
      Placeholder,
    );
    const today = SCREENS.find((s) => s.route === "/rep/today")!;
    const week = SCREENS.find((s) => s.route === "/rep/week")!;
    expect(reg.entry("/rep/today")).toMatchObject({ folder: "rep/today", implemented: true });
    expect(reg.entry("/rep/week")).toMatchObject({ folder: "rep/week", implemented: false });
    expect(reg.component(week)).toBe(Placeholder);
    const lazyToday = reg.component(today);
    expect(lazyToday).not.toBe(Placeholder);
    // Stable per folder so React never remounts the screen on re-render, and nothing loads until rendered.
    expect(reg.component(today)).toBe(lazyToday);
    expect(loads).toBe(0);
    expect(reg.orphans).toEqual(["rep/nope"]);
  });

  it("covers every app.json route with a <shell>/<screen> folder name", () => {
    const routes = Object.values(appContract.screens).flatMap((sh) => Object.values(sh).map((s) => s.route));
    expect(screenRegistry.entries.map((e) => e.screen.route).sort()).toEqual([...routes].sort());
    for (const e of screenRegistry.entries) {
      expect(e.folder).toBe(screenFolder(e.screen));
      expect(e.folder).toMatch(/^(rep|management)\/[a-z0-9_]+$/);
      expect(screenRegistry.component(e.screen)).toBeTruthy();
    }
    expect(screenRegistry.entry("/mgmt/settings/gdpr")?.folder).toBe("management/gdpr");
    expect(screenRegistry.entry("/rep/new-shops")?.folder).toBe("rep/new_shops");
    expect(screenRegistry.orphans).toEqual([]);
  });

  it("every registered screen dictionary is complete in el and en", () => {
    for (const [folder, m] of registeredScreenMessages()) {
      expect(screenRegistry.entries.some((e) => e.folder === folder), folder).toBe(true);
      expect(checkScreenMessages(m), folder).toEqual([]);
    }
  });
});
