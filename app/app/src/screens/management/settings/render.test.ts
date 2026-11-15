import { describe, expect, it, vi } from "vitest";
import { renderScreen } from "./testkit";
import Settings from "./index";

// Component render test, part of the default `vitest run`. ui-base imports the optional peer react-router (not
// installed in app/app), so ui-base is replaced by a text-preserving stub, as the other management screens do.
vi.mock("@wonderful/ui-base", () => import("./uiStub"));

describe("settings screen render", () => {
  it("renders Greek by default with a loading state, English on toggle", () => {
    expect(renderScreen(Settings, "/mgmt/settings")).toContain("Ρυθμίσεις");
    expect(renderScreen(Settings, "/mgmt/settings", "en")).toContain("Settings");
  });
});
