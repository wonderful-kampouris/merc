import { describe, expect, it } from "vitest";
import { MercApiError } from "../../../lib/client";
import { addDaysIso, bool, errorText, humanize, isUuid, num, objArr, str, strArr, withMockSeed } from "./kit";

describe("kit", () => {
  it("reads loose objects defensively", () => {
    const o = { a: "x", n: 3, b: true, arr: ["p", 1, "q"], bad: NaN };
    expect(str(o, "a")).toBe("x");
    expect(str(o, "n", "d")).toBe("d");
    expect(num(o, "n")).toBe(3);
    expect(num(o, "bad")).toBeNull();
    expect(bool(o, "b")).toBe(true);
    expect(strArr(o, "arr")).toEqual(["p", "q"]);
    expect(strArr(o, "nope")).toBeNull();
    expect(objArr([{}, 1, null, { x: 1 }])).toEqual([{}, { x: 1 }]);
  });
  it("dates, ids and codes", () => {
    expect(addDaysIso("2026-11-15", 6)).toBe("2026-11-21");
    expect(addDaysIso("2026-12-30", 3)).toBe("2027-01-02");
    expect(isUuid("006021ba-1b63-5646-9d18-85a40098c0c9")).toBe(true);
    expect(isUuid("lofos")).toBe(false);
    expect(humanize("send_email")).toBe("send email");
  });
  it("formats contract errors with their code", () => {
    expect(errorText(new MercApiError("x", { code: "forbidden", message: "no" }))).toBe("forbidden: x: no");
    expect(errorText(new Error("boom"))).toBe("boom");
  });
  it("falls back to seed rows only in mock mode and only when nothing parsed", () => {
    const parse = (rows: Record<string, unknown>[]) => rows.filter((r) => r.full_name).map((r) => String(r.full_name));
    expect(withMockSeed(false, [], "app_user", parse)).toEqual([]);
    expect(withMockSeed(true, ["kept"], "app_user", parse)).toEqual(["kept"]);
    expect(withMockSeed(true, [], "app_user", parse)).toContain("Eleni Markou");
  });
});
