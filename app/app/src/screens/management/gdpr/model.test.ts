import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mockClient, screenOf } from "../settings/testkit";
import { eraseConfirmed, exportFilename, exportSummary } from "./model";

const CONTACT = "416bbb0b-46bb-5b8d-be2c-d5cc354b6142";

describe("gdpr model", () => {
  it("erase needs the typed word in either language", () => {
    expect(eraseConfirmed("ΔΙΑΓΡΑΦΗ")).toBe(true);
    expect(eraseConfirmed(" διαγραφή ")).toBe(true);
    expect(eraseConfirmed("erase")).toBe(true);
    expect(eraseConfirmed("")).toBe(false);
    expect(eraseConfirmed("yes")).toBe(false);
  });
  it("export helpers", () => {
    expect(exportFilename(CONTACT, new Date("2026-11-15T10:00:00Z"))).toBe("contact-416bbb0b-2026-11-15.json");
    expect(exportSummary({ contact: { id: 1 }, activities: [1, 2], none: null })).toEqual([
      { key: "contact", count: 1 }, { key: "activities", count: 2 }, { key: "none", count: 0 },
    ]);
  });
  it("REQ-SET-004: export and erase go through the screen client only, erase with confirm=true", async () => {
    const { client, calls } = mockClient(screenOf("/mgmt/settings/gdpr"));
    await client.call("contact-export", { contact_id: CONTACT });
    expect(await client.call("contact-erase", { contact_id: CONTACT, confirm: true })).toEqual({ erased: true });
    expect(calls).toEqual(["contact-export", "contact-erase"]);
  });
  it("REQ-SET-004: no agent tool contract references contact-erase", () => {
    const dir = join(__dirname, "../../../../../../spec/contracts/tools");
    const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));
    const all = files(dir);
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((f) => readFileSync(f, "utf8").includes("contact-erase"))).toEqual([]);
  });
});
