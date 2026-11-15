import { describe, expect, it, vi } from "vitest";
import { renderScreen } from "../settings/testkit";
import ImportScreen from "./index";

// Component render test, part of the default `vitest run`. ui-base imports the optional peer react-router (not
// installed in app/app), so ui-base is replaced by a text-preserving stub, as the other management screens do.
vi.mock("@wonderful/ui-base", () => import("../settings/uiStub"));

describe("import screen render", () => {
  it("renders", () => {
    expect(renderScreen(ImportScreen, "/mgmt/import")).toContain("Ανέβασμα και αντιστοίχιση");
    expect(renderScreen(ImportScreen, "/mgmt/import", "en")).toContain("Upload and map");
  });
});
