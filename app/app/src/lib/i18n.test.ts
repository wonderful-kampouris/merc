import { describe, expect, it } from "vitest";
import { DEFAULT_LANG, initialLang, MESSAGES, screenTitleKey, translate } from "./i18n";
import { SCREENS } from "./routes";

describe("i18n (REQ-APP-005)", () => {
  it("defaults to Greek", () => {
    expect(DEFAULT_LANG).toBe("el");
    expect(initialLang()).toBe("el");
  });

  it("has every label in both languages, and Greek differs from English for screen titles", () => {
    expect(Object.keys(MESSAGES.el).sort()).toEqual(Object.keys(MESSAGES.en).sort());
    for (const v of [...Object.values(MESSAGES.el), ...Object.values(MESSAGES.en)]) expect(v.trim()).not.toBe("");
    for (const s of SCREENS) {
      const key = screenTitleKey(s.shell, s.key);
      expect(key).not.toBe("app.title");
      if (s.key !== "gdpr") expect(translate("el", key)).not.toBe(translate("en", key));
    }
  });
});
