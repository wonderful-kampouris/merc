import { describe, expect, it, vi } from "vitest";
import { renderScreen } from "../settings/testkit";
import Campaigns from "./index";

// Component render test, part of the default `vitest run`. ui-base imports the optional peer react-router (not
// installed in app/app), so ui-base is replaced by a text-preserving stub, as the other management screens do.
vi.mock("@wonderful/ui-base", () => import("../settings/uiStub"));

describe("campaigns screen render", () => {
  it("renders in Greek and English", () => {
    expect(renderScreen(Campaigns, "/mgmt/campaigns")).toContain("Νέα καμπάνια από κείμενο");
    expect(renderScreen(Campaigns, "/mgmt/campaigns", "en")).toContain("New campaign from text");
  });
});
