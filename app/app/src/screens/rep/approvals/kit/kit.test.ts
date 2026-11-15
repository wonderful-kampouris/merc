import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MercApiError } from "../../../../lib/client";
import { checkScreenMessages } from "../../../../lib/i18n";
import { findScreen } from "../../../../lib/routes";
import { getErrorKey } from "./errorKey";
import { addDays, formatDay, getToday } from "./format";
import kitMessages from "./kitMessages";
import { createOverride, getMerged } from "./overrides";

const ROOT = join(__dirname, "..", "..");
const SCREENS = { approvals: "/rep/approvals", alerts: "/rep/alerts", new_shops: "/rep/new-shops", week: "/rep/week", ai_log: "/rep/ai-log" } as const;

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "kit" ? [] : sources(p);
    return /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [readFileSync(p, "utf8")] : [];
  });

describe("WP-APP-04 kit", () => {
  it("overrides survive a refetch of the same server row and drop when the server row changes", () => {
    const rows = [{ id: "a", s: "pending" }, { id: "b", s: "pending" }];
    const map = createOverride(new Map(), "a", rows[0], { id: "a", s: "sent" });
    expect(getMerged(rows, (r) => r.id, map)).toEqual([{ id: "a", s: "sent" }, { id: "b", s: "pending" }]);
    expect(getMerged([{ id: "a", s: "expired" }], (r) => r.id, map)).toEqual([{ id: "a", s: "expired" }]);
  });

  it("maps contract error codes to messages in both languages", () => {
    expect(getErrorKey(new MercApiError("x", { code: "forbidden", message: "no" }))).toBe("err.forbidden");
    expect(getErrorKey(new Error("boom"))).toBe("err.unknown");
    expect(checkScreenMessages(kitMessages)).toEqual([]);
  });

  it("formats dates in Greek by default and does date-only arithmetic", () => {
    expect(addDays("2026-11-16", 7)).toBe("2026-11-23");
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(formatDay("2026-11-16", "en")).toMatch(/Mon/);
    expect(formatDay("2026-11-16", "el")).toMatch(/Δευ/);
    expect(getToday(new Date("2026-11-15T23:30:00Z"))).toBe("2026-11-16");
  });

  it("each screen calls only the functions app.json lists for it (REQ-APP-001)", () => {
    for (const [folder, route] of Object.entries(SCREENS)) {
      const allowed = new Set(findScreen(route)!.functions);
      const called = new Set(sources(join(ROOT, folder)).flatMap((src) => [...src.matchAll(/\.call\(\s*"([a-z-]+)"/g)].map((m) => m[1]!)));
      expect(called.size, folder).toBeGreaterThan(0);
      for (const slug of called) expect(allowed.has(slug), `${folder} calls ${slug}`).toBe(true);
    }
  });
});
