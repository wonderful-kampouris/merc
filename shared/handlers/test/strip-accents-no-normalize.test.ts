// The agent tool runtime has no String.prototype.normalize; name matching must still work there.
import { describe, expect, it } from "vitest";

describe("stripAccents without String.prototype.normalize", () => {
  it("folds Latin and Greek accents via the fallback table", async () => {
    const orig = String.prototype.normalize;
    // @ts-expect-error simulate the tool runtime
    delete String.prototype.normalize;
    try {
      const { stripAccents } = await import("../../core/src/text?nonorm" as string);
      expect(stripAccents("Café Miltos")).toBe("Cafe Miltos");
      expect(stripAccents("Φούρνος Σταύρου")).toBe("Φουρνος Σταυρου");
      const { normalizeName } = await import("../src/accounts-list?nonorm" as string);
      expect(normalizeName("Café Miltos")).toBe("cafe miltos");
    } finally {
      String.prototype.normalize = orig;
    }
  });
});
