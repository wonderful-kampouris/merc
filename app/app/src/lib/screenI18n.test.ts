import { describe, expect, it } from "vitest";
import { checkScreenMessages, defineScreenMessages, registerScreenMessages, registeredScreenMessages, translateScreen } from "./i18n";

const m = defineScreenMessages({
  en: { title: "Visits today", count: "{n} visits", only_en: "x" },
  el: { title: "Επισκέψεις σήμερα", count: "{n} επισκέψεις", only_en: "x" },
});

describe("per-screen i18n dictionaries", () => {
  it("translates screen keys in the active language, Greek default, with placeholders", () => {
    expect(translateScreen(m, "el", "title")).toBe("Επισκέψεις σήμερα");
    expect(translateScreen(m, "en", "title")).toBe("Visits today");
    expect(translateScreen(m, "el", "count", { n: 3 })).toBe("3 επισκέψεις");
  });

  it("falls back to the app-wide dictionary, then to the key", () => {
    expect(translateScreen(m, "el", "common.loading")).toBe("Φόρτωση…");
    expect(translateScreen(m, "en", "nope.key")).toBe("nope.key");
  });

  it("flags missing and empty translations", () => {
    expect(checkScreenMessages(m)).toEqual([]);
    const bad = { en: { a: "A", b: "B" }, el: { a: " " } } as never;
    expect(checkScreenMessages(bad).sort()).toEqual(["a: empty in el", "b: missing in el"]);
  });

  it("registers a folder's dictionary", () => {
    registerScreenMessages("rep/test_only", m);
    expect(registeredScreenMessages().get("rep/test_only")).toBe(m);
    (registeredScreenMessages() as Map<string, unknown>).delete("rep/test_only");
  });
});
