import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl, makeImpl } from "../src/product-lookup";
import { kit, ok, errCode, DEMO_DAY } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const NOW = Date.parse(`${DEMO_DAY}T10:00:00Z`);
const h = (now = NOW) => makeImpl({ now: () => now });
const NUOVO = "b28bc378-ec47-55d6-a414-b09ac0dacc3d";

describe("fn:product-lookup (REQ-CRD-005)", () => {
  it('"How much is Espresso Nuovo?" -> 21.50 per kg from the catalog, with its active campaign', async () => {
    const t = kit();
    const r = ok(await runAsTool("product-lookup", h(), t.toolCtx("nikos"), { query: "Espresso Nuovo" }, t.key));
    expect(r.items[0]).toEqual({
      product_id: NUOVO, sku: "ESP-NEW-1", name: "Espresso Nuovo Blend 1kg", unit: "kg", list_price_minor: 2150,
      category: "Coffee", active_campaigns: ["Espresso Nuovo to cafés"], stock: "unknown",
    });
    expect(r.items).toHaveLength(1);
    expect(validateResponse("product-lookup", r).ok).toBe(true);
  });

  it("matches case-, accent- and punctuation-insensitively, by SKU, and token-wise", async () => {
    const t = kit();
    for (const q of ["espresso nuovo", "ESPRESSO-NUOVO", "esp-new-1", "nuovo"]) {
      expect(ok(await runAsTool("product-lookup", h(), t.toolCtx("nikos"), { query: q }, t.key)).items[0]?.product_id).toBe(NUOVO);
    }
    const espresso = ok(await runAsTool("product-lookup", h(), t.toolCtx("nikos"), { query: "espresso" }, t.key)).items;
    expect(espresso.map((i) => i.sku).sort()).toEqual(["ESP-CL-1", "ESP-DEC-1", "ESP-NEW-1"]);
    expect(ok(await runAsTool("product-lookup", h(), t.toolCtx("nikos"), { query: "caviar" }, t.key)).items).toEqual([]);
  });

  it("inactive products are not offered; campaigns only count while active and in dates", async () => {
    const t = kit();
    await t.db.product.update(NUOVO, { active: false });
    expect(ok(await runAsTool("product-lookup", h(), t.toolCtx("nikos"), { query: "Espresso Nuovo" }, t.key)).items).toEqual([]);
    await t.db.product.update(NUOVO, { active: true });
    const after = ok(await runAsTool("product-lookup", h(NOW + 10 * 86_400_000), t.toolCtx("nikos"), { query: "Espresso Nuovo" }, t.key));
    expect(after.items[0]!.active_campaigns).toEqual([]);
  });

  it("deployed entry: contract request checked, no user -> forbidden, spoofed caller ignored, same as tool", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx(null, { query: "nuovo" })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", {})))).toBe("validation_failed");
    expect(validateRequest("product-lookup", { query: "x", extra: 1 }).ok).toBe(false);
    const viaFn = ok(await handle(t.fnCtx("nikos", { query: "nuovo", caller: { user_id: "x" } })));
    expect(viaFn.items[0]!.list_price_minor).toBe(2150);
    expect(await runAsTool("product-lookup", impl, t.toolCtx("dimitra"), { query: "nuovo" }, t.key)).toEqual(ok(await handle(t.fnCtx("dimitra", { query: "nuovo" }))));
  });

  it("functions/product-lookup/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "product-lookup", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("product-lookup"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
