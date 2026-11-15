import { describe, expect, it } from "vitest";
import {
  callMock, eventContracts, functionSlugs, llmContracts, mockEvent, mockHandlers, mockLlmOutput, mockResult,
  resolveToken, seedRowById, seedRows, validateEvent, validateLlmOutput, validateResponse,
  type EventType, type LlmSchemaName,
} from "../src/index.js";

const DAY = new Date(Date.UTC(2026, 10, 15)); // Sunday 2026-11-15
const ACC = "59b5e454-cc4b-5fab-939b-a50c78e8aa9b";

describe("mock handlers", () => {
  it("one handler per function, every result schema-valid (seeded and unseeded)", () => {
    const slugs = functionSlugs();
    expect(Object.keys(mockHandlers).sort()).toEqual(slugs);
    for (const s of slugs) {
      for (const useSeed of [true, false]) {
        const r = validateResponse(s, mockResult(s, {}, { demoDay: DAY, useSeed }));
        expect(r.ok, `${s} useSeed=${useSeed} ${r.ok ? "" : r.errors.join("; ")}`).toBe(true);
      }
    }
  });

  it("is deterministic", () => {
    expect(mockResult("me", {}, { demoDay: DAY })).toEqual(mockResult("me", {}, { demoDay: DAY }));
  });

  it("is seed-backed: account-get returns the requested seeded account and its contacts", () => {
    const reply = mockHandlers["account-get"]({ account_id: ACC }, { demoDay: DAY });
    if (!("result" in reply)) throw new Error("expected result");
    expect(reply.result.account.name).toBe("Café Miltos");
    expect(reply.result.account.customer_since).toBe("2025-10-11"); // @D-400 resolved
    for (const c of reply.result.contacts) expect(c.account_id).toBe(ACC);
    expect(reply.logs).toBeInstanceOf(Array);
  });

  it("list mocks use seed rows for items", () => {
    const r = mockResult("deals-list", { account_id: ACC }, { demoDay: DAY });
    const deals = seedRows("deal").filter((d) => d.account_id === ACC);
    expect(r.items.length).toBe(Math.min(2, deals.length));
    if (deals.length) expect(r.items[0]!.id).toBe(deals[0]!.id);
  });

  it("returns validation_failed for a bad request and coerces GET query strings", () => {
    const bad = callMock("account-get", { account_id: 7 });
    expect("error" in bad && bad.error.code).toBe("validation_failed");
    const ok = callMock("deals-list", { page: "1" });
    expect("result" in ok).toBe(true);
  });

  it("events and llm outputs mock as schema-valid", () => {
    for (const t of Object.keys(eventContracts) as EventType[]) {
      const r = validateEvent(mockEvent(t, { demoDay: DAY }));
      expect(r.ok, `${t} ${r.ok ? "" : r.errors.join("; ")}`).toBe(true);
    }
    for (const n of Object.keys(llmContracts) as LlmSchemaName[]) {
      const r = validateLlmOutput(n, mockLlmOutput(n, { demoDay: DAY }));
      expect(r.ok, `${n} ${r.ok ? "" : r.errors.join("; ")}`).toBe(true);
    }
  });
});

describe("seed tokens", () => {
  it("resolves relative dates and anchors", () => {
    expect(resolveToken("@D", { demoDay: DAY })).toBe("2026-11-15");
    expect(resolveToken("@D-12", { demoDay: DAY })).toBe("2026-11-03");
    expect(resolveToken("@D+3@09:30", { demoDay: DAY })).toBe("2026-11-18T09:30:00.000Z");
    expect(resolveToken("@WEEK_START", { demoDay: DAY })).toBe("2026-11-09");
    expect(resolveToken("@MONTH_START", { demoDay: DAY })).toBe("2026-11-01");
    expect(resolveToken("@MONTH_END", { demoDay: DAY })).toBe("2026-11-30");
    expect(resolveToken("@wuid:nikos", { wuids: { nikos: "u-1" } })).toBe("u-1");
    expect(resolveToken("plain")).toBe("plain");
  });
  it("finds seed rows by id", () => {
    expect(seedRowById("account", ACC)?.name).toBe("Café Miltos");
  });
});
