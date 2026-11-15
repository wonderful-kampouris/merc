import { describe, expect, it, vi } from "vitest";
import { validateResponse } from "../contracts";
import { createClient, MercApiError, unwrap, type FunctionInvoker } from "./client";

const invoker = (impl: (slug: string, o?: unknown) => unknown): FunctionInvoker & { calls: unknown[][] } => {
  const calls: unknown[][] = [];
  return {
    calls,
    invokeFunction: async <T,>(slug: string, o?: unknown) => {
      calls.push([slug, o]);
      return (await impl(slug, o)) as T;
    },
  };
};

describe("client mock mode", () => {
  it("answers from the contract mocks with schema-valid results and never calls the platform", async () => {
    const inv = invoker(() => {
      throw new Error("should not be called");
    });
    const c = createClient({ mock: true, invoker: inv });
    const today = await c.call("today-get", {});
    expect(validateResponse("today-get", today).ok).toBe(true);
    expect(inv.calls).toHaveLength(0);
  });

  it("rejects an invalid request before calling anything", async () => {
    const c = createClient({ mock: true, invoker: invoker(() => ({})) });
    await expect(c.call("account-get", {} as never)).rejects.toMatchObject({ code: "validation_failed", status: 422 });
  });
});

describe("client live mode", () => {
  it("calls api.invokeFunction with the folder-qualified slug and contract method, and unwraps {result, logs}", async () => {
    const mock = createClient({ mock: true, invoker: invoker(() => ({})) });
    const sample = await mock.call("today-get", {});
    const inv = invoker(() => ({ result: sample, logs: ["ok"] }));
    const c = createClient({ mock: false, invoker: inv });
    await expect(c.call("today-get", {})).resolves.toEqual(sample);
    expect(inv.calls[0]).toEqual(["merc/today-get", { method: "GET", params: {} }]);
  });

  it("maps a contract {error} body to MercApiError with the stable status", async () => {
    const c = createClient({ mock: false, invoker: invoker(() => ({ error: { code: "not_found", message: "no such account" } })) });
    const err = await c.call("today-get", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MercApiError);
    expect(err).toMatchObject({ code: "not_found", status: 404 });
  });

  it("maps a thrown SDK 403 to forbidden", async () => {
    const c = createClient({ mock: false, invoker: invoker(() => Promise.reject(new Error('Function "merc/today-get" is not permitted for this app.'))) });
    await expect(c.call("today-get", {})).rejects.toMatchObject({ code: "forbidden" });
  });

  it("fails a response that breaks the contract", async () => {
    const c = createClient({ mock: false, invoker: invoker(() => ({ result: { nope: true } })) });
    await expect(c.call("today-get", {})).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("screen allowlist (REQ-APP-001)", () => {
  it("blocks slugs that the screen does not list", async () => {
    const spy = vi.fn();
    const c = createClient({ mock: true, invoker: { invokeFunction: spy } }).forScreen(["today-get"]);
    await expect(c.call("deals-list", {} as never)).rejects.toMatchObject({ code: "forbidden" });
    await expect(c.call("today-get", {})).resolves.toBeTruthy();
  });
});

describe("unwrap", () => {
  it("passes a bare result through and recognises wrappers", () => {
    expect(unwrap({ result: 1, logs: [] })).toEqual({ result: 1 });
    expect(unwrap({ items: [] })).toEqual({ result: { items: [] } });
    expect(unwrap({ error: { code: "conflict", message: "x" } })).toEqual({ error: { code: "conflict", message: "x" } });
  });
});
