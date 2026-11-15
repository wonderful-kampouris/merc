import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkScreenMessages } from "../../../lib/i18n";
import { SCREENS } from "../../../lib/routes";
import customersMessages from "./i18n";
import todayMessages from "../today/i18n";

const here = dirname(fileURLToPath(import.meta.url));
const sources = (folder: string) =>
  readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.ts$/.test(f) && !f.startsWith("testing"))
    .map((f) => readFileSync(join(folder, f), "utf8"))
    .join("\n");
const calledSlugs = (src: string) => [...src.matchAll(/\.call\(\s*"([a-z0-9-]+)"/g)].map((m) => m[1]!);

describe("WP-APP-02 screens follow app.json", () => {
  for (const key of ["today", "customers"]) {
    it(`rep/${key} only calls the functions app.json lists for it`, () => {
      const screen = SCREENS.find((s) => s.shell === "rep" && s.key === key)!;
      const slugs = calledSlugs(sources(join(here, "..", key)));
      expect(slugs.length).toBeGreaterThan(0);
      for (const s of slugs) expect(screen.functions, `${key} calls ${s}`).toContain(s);
    });
  }

  it("both dictionaries are complete in Greek and English", () => {
    expect(checkScreenMessages(todayMessages)).toEqual([]);
    expect(checkScreenMessages(customersMessages)).toEqual([]);
  });

  it("Today is the offline screen", () => {
    expect(SCREENS.find((s) => s.route === "/rep/today")?.offline).toBe(true);
  });
});
