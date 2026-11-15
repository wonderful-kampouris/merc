import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ERROR_STATUS, apiError, functionSlugs, validateError, validateEvent, validateRequest, validateResponse, validateWrappedResponse } from "../src/index.js";

const ACC = "59b5e454-cc4b-5fab-939b-a50c78e8aa9b"; // seed: Café Miltos
const USER = "bcc2830f-a618-5ab1-bb5c-46707c21a9e6";

describe("validateRequest / validateResponse on 5 functions", () => {
  it("me: empty request only; response needs a UserRef", () => {
    expect(validateRequest("me", {}).ok).toBe(true);
    const bad = validateRequest("me", { user_id: USER });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("validation_failed");
    expect(validateResponse("me", { user: { id: USER, full_name: "X", role: "rep" } }).ok).toBe(false); // missing required
  });

  it("account-get: uuid required, response shape strict", () => {
    expect(validateRequest("account-get", { account_id: ACC }).ok).toBe(true);
    expect(validateRequest("account-get", {}).ok).toBe(false);
    expect(validateRequest("account-get", { account_id: "nope" }).ok).toBe(false);
    expect(validateResponse("account-get", { account: {}, contacts: [], deals: [], activities: [] }).ok).toBe(true);
    const extra = validateResponse("account-get", { account: {}, contacts: [], deals: [], activities: [], x: 1 });
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.errors.join()).toMatch(/x/);
  });

  it("candidate-act: enum action, nullable optionals", () => {
    expect(validateRequest("candidate-act", { candidate_id: ACC, action: "dismiss", rep_id: null, date: "2026-11-15" }).ok).toBe(true);
    expect(validateRequest("candidate-act", { candidate_id: ACC, action: "explode" }).ok).toBe(false);
    expect(validateRequest("candidate-act", { candidate_id: ACC, action: "assign", date: "15/11/2026" }).ok).toBe(false);
  });

  it("deals-list: GET query coercion and Page in response", () => {
    expect(validateRequest("deals-list", { page: "2" }).ok).toBe(false);
    const q: Record<string, unknown> = { page: "2", limit: "20" };
    expect(validateRequest("deals-list", q, { coerce: true }).ok).toBe(true);
    expect(q.page).toBe(2);
    expect(validateResponse("deals-list", { items: [{}], page: { page: 1, limit: 20, total: 1 } }).ok).toBe(true);
    expect(validateResponse("deals-list", { items: [], page: { page: 1 } }).ok).toBe(false);
  });

  it("debrief-process: status enum and ResultCard ref", () => {
    expect(validateRequest("debrief-process", { utterance: "Είδα τον Μίλτο", account_id: ACC }).ok).toBe(true);
    expect(validateRequest("debrief-process", { utterance: 42 }).ok).toBe(false);
    expect(validateResponse("debrief-process", { status: "weird", result: null, candidates: [], question: null }).ok).toBe(false);
  });

  it("wrapped platform responses", () => {
    expect(validateWrappedResponse("account-get", { result: { account: {}, contacts: [], deals: [], activities: [] }, logs: [] }).ok).toBe(true);
    expect(validateWrappedResponse("account-get", { error: { code: "not_found", message: "no" } }).ok).toBe(true);
    expect(validateWrappedResponse("account-get", { foo: 1 }).ok).toBe(false);
  });

  it("unknown slug throws", () => {
    expect(() => validateRequest("nope" as never, {})).toThrow(/unknown function/);
  });

  it("every function's schemas compile", () => {
    const slugs = functionSlugs();
    const files = readdirSync(join(import.meta.dirname, "../../../spec/contracts/functions")).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
    expect(slugs).toEqual(files.map((f) => f.replace(/\.json$/, "")).sort());
    for (const s of slugs) {
      expect(() => validateRequest(s, {})).not.toThrow();
      expect(() => validateResponse(s, {})).not.toThrow();
    }
  });
});

describe("Error schema (REQ-CORE-008)", () => {
  it.each([
    [404, "not_found"],
    [403, "forbidden"],
    [422, "validation_failed"],
    [409, "conflict"],
  ] as const)("%i -> %s has a valid Error shape", (status, code) => {
    expect(ERROR_STATUS[code]).toBe(status);
    const body = apiError(code, "msg", { id: ACC });
    expect(validateError(body.error).ok).toBe(true);
  });
  it("rejects unstable codes and extra keys", () => {
    expect(validateError({ code: "oops", message: "x" }).ok).toBe(false);
    expect(validateError({ code: "not_found", message: "x", stack: "..." }).ok).toBe(false);
    expect(validateError({ code: "not_found" }).ok).toBe(false);
  });
});

describe("events envelope", () => {
  it("rejects unknown type and bad at", () => {
    expect(validateEvent({ type: "nope", at: new Date().toISOString(), payload: {} }).ok).toBe(false);
    expect(validateEvent({ type: "alert.created", at: "yesterday", payload: {} }).ok).toBe(false);
  });
});
