import { describe, expect, it } from "vitest";
import { createHmac, createHash } from "node:crypto";
import { hmacSha256Hex, safeEqual } from "../src/index";
import { sha256 } from "../src/hmac";

describe("pure-TS HMAC-SHA256", () => {
  it("matches node:crypto", () => {
    const cases: [string, string][] = [["k", ""], ["secret", "user|org|123"], ["κλειδί", "Καφέ Μίλτος"], ["x".repeat(100), "y".repeat(1000)], ["a".repeat(64), "b".repeat(55)], ["", "c".repeat(64)]];
    for (const [k, m] of cases) expect(hmacSha256Hex(k, m)).toBe(createHmac("sha256", k).update(m).digest("hex"));
    for (const n of [0, 55, 56, 63, 64, 65, 200]) expect(Buffer.from(sha256(new Uint8Array(n).fill(7))).toString("hex")).toBe(createHash("sha256").update(Buffer.alloc(n, 7)).digest("hex"));
  });
  it("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});
