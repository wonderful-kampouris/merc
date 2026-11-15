import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateResponse } from "../../core/src/index";
import { kit, ok, errCode } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle } from "../src/import-get";
import { handle as start } from "../src/import-start";
import type { StorageLike } from "../src/import-analyze";
import { messyAccounts, toCsv } from "../../../procedures/import-pipeline/fixtures/make-fixtures";

function fakeStorage() {
  const files = new Map<string, Uint8Array>();
  const storage: StorageLike = {
    upload: async (k, d) => { files.set(k, d); return { key: k }; },
    download: async (k) => { const d = files.get(k); if (!d) throw new Error("not-found"); return { data: d }; },
  };
  return storage;
}
const ctx = (t: ReturnType<typeof kit>, storage: StorageLike | null, who: any, body: unknown) => Object.assign(t.fnCtx(who, body), { storage }) as any;

describe("fn:import-get (REQ-IMP-001, REQ-IMP-002)", () => {
  it("returns the mapping with confidence, each bad row with its reason, and a cleaned preview", async () => {
    const t = kit();
    const storage = fakeStorage();
    const { expected, grid } = messyAccounts();
    const s = ok(await start(ctx(t, storage, "thanasis", { data_type: "accounts", filename: "a.csv", csv_base64: Buffer.from(toCsv(grid)).toString("base64") })));
    const r = ok(await handle(ctx(t, storage, "thanasis", { import_id: s.import_id })));
    expect(validateResponse("import-get", r).ok).toBe(true);
    expect(r.import).toMatchObject({ id: s.import_id, status: "preview", rows_total: 200, filename: "a.csv", confirm_below: 0.6, preview_error: null });
    expect((r.import as any).confirmations_needed).toBeLessThanOrEqual(2);
    expect((r.import as any).target_fields.find((f: any) => f.field === "name")).toMatchObject({ required: true });
    expect(r.mapping.map((m: any) => m.source_column)[0]).toBe("Κωδ. Πελάτη"); // file column order
    expect(r.mapping.find((m: any) => m.source_column === "Α.Φ.Μ.")).toMatchObject({ target_field: "vat_number", confirmed: true, needs_confirmation: false });
    expect(r.issues).toHaveLength(expected.length);
    expect(r.issues[0]).toEqual({ row_no: expect.any(Number), issue_type: expect.any(String), detail: expect.any(String) });
    expect(r.preview_rows).toHaveLength(20);
    const p3 = r.preview_rows.find((p: any) => p.row_no === 6) as any; // C-10003
    expect(p3).toMatchObject({ action: "import", values: { vat_number: "900100003", phone: "+306944000003", postal_code: "15234" } });
    const bad = r.preview_rows.find((p: any) => p.row_no === 10) as any; // i=7, invalid VAT
    expect(bad.issues[0]).toMatchObject({ issue_type: "invalid_vat" });
  });
  it("without storage the import and issues still load, the preview says why it is empty", async () => {
    const t = kit();
    const storage = fakeStorage();
    const s = ok(await start(ctx(t, storage, "thanasis", { data_type: "accounts", filename: "a.csv", csv_base64: Buffer.from("name;vat\nA;1\n").toString("base64") })));
    const r = ok(await handle(ctx(t, null, "thanasis", { import_id: s.import_id })));
    expect(r.preview_rows).toEqual([]);
    expect((r.import as any).preview_error).toMatch(/blocked_by_policy/);
    expect(r.issues).toHaveLength(1);
  });
  it("gate import.manage: reps and managers are forbidden; unknown id is not_found", async () => {
    const t = kit();
    expect(errCode(await handle(ctx(t, fakeStorage(), "nikos", { import_id: "00000000-0000-4000-8000-000000000000" })))).toBe("forbidden");
    expect(errCode(await handle(ctx(t, fakeStorage(), "eleni", { import_id: "00000000-0000-4000-8000-000000000000" })))).toBe("forbidden");
    expect(errCode(await handle(ctx(t, fakeStorage(), "thanasis", { import_id: "00000000-0000-4000-8000-000000000000" })))).toBe("not_found");
    expect(errCode(await handle(ctx(t, fakeStorage(), "thanasis", { import_id: "x" })))).toBe("validation_failed");
  });

  it("functions/import-get/handler.gen.js is the current bundle (run `pnpm bundle import-get` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "import-get", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("import-get"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
