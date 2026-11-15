import { describe, expect, it } from "vitest";
import { check, validateRequest, validateResponse, validateSchema, validateError, defineFunction, meResponse } from "../src/index";
import { defs, functions } from "../src/generated/contracts/schemas";
import { defs as cDefs, functions as cFunctions } from "../../../packages/contracts/src/generated/schemas";
import { mockResult, validateResponse as ajvResponse, functionSlugs } from "../../../packages/contracts/src/index";
import { seeded, fnCtx } from "./fake-tables";
import { readdirSync } from "node:fs";

// Count comes from spec/contracts, never a literal (it changes as contracts grow).
const CONTRACT_FNS = readdirSync(new URL("../../../spec/contracts/functions/", import.meta.url)).filter((f) => f.endsWith(".json") && !f.startsWith("_")).length;

function findPath(v: any, pred: (k: string, x: unknown) => boolean, path: (string | number)[] = []): (string | number)[] | null {
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
    if (!Array.isArray(v) && pred(k, x)) return [...path, k];
    const r = findPath(x, pred, [...path, Array.isArray(v) ? Number(k) : k]);
    if (r) return r;
  }
  return null;
}
const setPath = (o: any, p: (string | number)[], val: unknown) => { const c = structuredClone(o); p.slice(0, -1).reduce((a, k) => a[k], c)[p.at(-1)!] = val; return c; };

describe("contract validation", () => {
  it("vendored contract schemas are identical to @merc/contracts", () => {
    expect(JSON.stringify(functions)).toBe(JSON.stringify(cFunctions));
    expect(JSON.stringify(defs)).toBe(JSON.stringify(cDefs));
  });

  it("agrees with the Ajv validator on every function's mock response", () => {
    const slugs = functionSlugs();
    expect(slugs.length).toBe(CONTRACT_FNS);
    for (const s of slugs) {
      const r = mockResult(s, {});
      expect(ajvResponse(s, r).ok, s).toBe(true);
      const mine = validateResponse(s, r);
      expect(mine.ok, `${s}: ${!mine.ok && mine.errors.join("; ")}`).toBe(true);
    }
  });

  it("REQ-CORE-007: rejects a float in a *_minor field of a real contract response", () => {
    let tested = 0;
    for (const s of functionSlugs()) {
      const r = mockResult(s, {});
      const p = findPath(r, (k, x) => k.endsWith("_minor") && typeof x === "number");
      if (!p) continue;
      const bad = validateResponse(s, setPath(r, p, 12.5));
      expect(bad.ok, s).toBe(false);
      if (!bad.ok) expect(bad.error.code).toBe("validation_failed");
      tested++;
    }
    expect(tested).toBeGreaterThan(0);
    expect(check({ type: "object", properties: { total_minor: { type: "number" } } }, { total_minor: 1.5 })[0]).toMatch(/integer in minor units/);
    expect(check({ type: "object", properties: { total_minor: { type: "number" } } }, { total_minor: 150 })).toEqual([]);
  });

  it("REQ-CORE-007: percentages must be 0-100", () => {
    const s = { type: "object", properties: { discount_pct: { type: "number" } } };
    expect(validateSchema(s, { discount_pct: 8 }).ok).toBe(true);
    expect(validateSchema(s, { discount_pct: 101 }).ok).toBe(false);
    expect(validateSchema(s, { discount_pct: -1 }).ok).toBe(false);
    const d = { type: "object", properties: { price_delta_pct: { type: "number" } } };
    expect(validateSchema(d, { price_delta_pct: -15 }).ok).toBe(true);
    expect(validateSchema(d, { price_delta_pct: -150 }).ok).toBe(false);
    expect(validateSchema(d, { price_delta_pct: 101 }).ok).toBe(false);
  });

  it("validates requests: required, unknown fields, formats, GET coercion", () => {
    expect(validateRequest("account-get", {}).ok).toBe(false);
    expect(validateRequest("account-get", { account_id: "not-a-uuid" }).ok).toBe(false);
    expect(validateRequest("account-get", { account_id: "59b5e454-cc4b-5fab-939b-a50c78e8aa9b", extra: 1 }).ok).toBe(false);
    expect(validateRequest("account-get", { account_id: "59b5e454-cc4b-5fab-939b-a50c78e8aa9b" }).ok).toBe(true);
    const page = Object.entries((functions as any)["accounts-list"].request.properties).find(([, v]: any) => v.type === "integer" || v.anyOf?.some((b: any) => b.type === "integer"))!;
    expect(validateRequest("accounts-list", { [page[0]]: "2" }).ok).toBe(false);
    const co = validateRequest("accounts-list", { [page[0]]: "2" }, { coerce: true });
    expect(co.ok && (co.value as any)[page[0]]).toBe(2);
  });

  it("handler returns contract Error shapes for invalid requests and broken responses", async () => {
    const bad: any = await defineFunction("account-get", async () => ({}) as any)({ tables: seeded(), ...fnCtx("wuid-nikos", { account_id: 5 }) });
    expect(bad.error.code).toBe("validation_failed");
    expect(validateError(bad.error).ok).toBe(true);
    const broken: any = await defineFunction("me", async ({ me }) => ({ ...meResponse(me), org_id: 42 }) as any)({ tables: seeded(), ...fnCtx("wuid-nikos") });
    expect(broken.error.code).toBe("validation_failed");
    expect(broken.error.details.errors[0]).toMatch(/org_id/);
  });
});
