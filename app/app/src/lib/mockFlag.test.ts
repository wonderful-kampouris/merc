import { describe, expect, it } from "vitest";
import { resolveMockFlag } from "./mockFlag";

describe("mock flag", () => {
  it("is off by default and turned on by ?mock=1, or VITE_MERC_MOCK (a stored flag is ignored)", () => {
    expect(resolveMockFlag({ query: null, stored: null })).toBe(false);
    expect(resolveMockFlag({ query: "1", stored: "0" })).toBe(true);
    expect(resolveMockFlag({ query: "0", stored: "1", env: "1" })).toBe(false);
    expect(resolveMockFlag({ query: null, stored: "1" })).toBe(false);
    expect(resolveMockFlag({ query: null, stored: null, env: "1" })).toBe(true);
  });
});
