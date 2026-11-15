import { describe, expect, it, vi } from "vitest";
import { renderScreen } from "../settings/testkit";
import Gdpr from "./index";

// Component render test, part of the default `vitest run`. ui-base imports the optional peer react-router (not
// installed in app/app), so ui-base is replaced by a text-preserving stub, as the other management screens do.
vi.mock("@wonderful/ui-base", () => import("../settings/uiStub"));

describe("gdpr screen render", () => {
  it("renders", () => {
    expect(renderScreen(Gdpr, "/mgmt/settings/gdpr")).toContain("Εξαγωγή δεδομένων");
    expect(renderScreen(Gdpr, "/mgmt/settings/gdpr", "en")).toContain("Export data");
  });
});
