import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CUSTOMER_FOCUS_KEY, clearCustomerFocus, peekCustomerFocus, setCustomerFocus } from "./customerFocus";

const MILTOS = "59b5e454-cc4b-5fab-939b-a50c78e8aa9b";

describe("customer focus hand-off", () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  it("survives repeated reads, so a remounted Customers screen keeps the card open", () => {
    setCustomerFocus(MILTOS);
    expect(peekCustomerFocus()).toBe(MILTOS);
    expect(peekCustomerFocus()).toBe(MILTOS);
    expect(globalThis.sessionStorage.getItem(CUSTOMER_FOCUS_KEY)).toBe(MILTOS);
  });

  it("is cleared by Back to list, so a later visit starts at the list", () => {
    setCustomerFocus(MILTOS);
    clearCustomerFocus();
    expect(peekCustomerFocus()).toBeNull();
  });

  it("returns null when storage is unavailable", () => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    expect(peekCustomerFocus()).toBeNull();
  });
});
