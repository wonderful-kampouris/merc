import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle } from "../src/import-confirm";
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
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const ctx = (t: ReturnType<typeof kit>, storage: StorageLike, who: any, body: unknown, extra: Record<string, unknown> = {}) => Object.assign(t.fnCtx(who, body), { storage, ...extra }) as any;

async function started(csv = toCsv(messyAccounts().grid)) {
  const t = kit();
  const storage = fakeStorage();
  const r = ok(await start(ctx(t, storage, "thanasis", { data_type: "accounts", filename: "a.csv", csv_base64: b64(csv) })));
  return { t, storage, id: r.import_id };
}

describe("fn:import-confirm (REQ-IMP-001)", () => {
  it("inline mode: confirming the preview (with an override) imports the clean rows and skips the bad ones", async () => {
    const { t, storage, id } = await started();
    const before = await t.db.account.count();
    const r = ok(await handle(ctx(t, storage, "thanasis", { import_id: id, mapping_overrides: [{ source_column: "Σημειώσεις", target_field: null }] })));
    expect(validateResponse("import-confirm", r).ok).toBe(true);
    expect(r).toEqual({ import_id: id, status: "imported" });
    const imp = await t.db.data_import.require(id);
    expect(imp).toMatchObject({ status: "imported", rows_total: 200, rows_imported: 195 });
    expect(imp.confirmed_at).toBeTruthy();
    expect(await t.db.account.count()).toBe(before + 195);
    expect((await t.db.import_column_mapping.all({ import_id: id })).every((m) => m.confirmed)).toBe(true);
    const a = await t.db.account.findOne({ external_ref: "C-10003" });
    expect(a).toMatchObject({ vat_number: "900100003", phone: "+306944000003", postal_code: "15234", source: "import", owner_rep_id: IDS.nikos, account_type: "customer", email: "shop003@example.gr" });
    expect(a!.territory_id).toBeTruthy();
    const a22 = await t.db.account.findOne({ external_ref: "C-10022" });
    expect(a22).toMatchObject({ street: "Οδός Δοκιμής 22", postal_code: "15232" });
    const a7 = await t.db.account.findOne({ external_ref: "C-10007" });
    expect(a7!.vat_number).toBeNull(); // invalid VAT reported, row still imported
    // idempotent
    expect(ok(await handle(ctx(t, storage, "thanasis", { import_id: id, mapping_overrides: [] }))).status).toBe("imported");
    expect(await t.db.account.count()).toBe(before + 195);
  });
  it("procedure mode: only flips the status to confirmed (the procedure's wait step then runs import-apply)", async () => {
    const { t, storage, id } = await started();
    await t.db.data_import.update(id, { procedure_run_id: "run-1" });
    const before = await t.db.account.count();
    expect(ok(await handle(ctx(t, storage, "thanasis", { import_id: id, mapping_overrides: [] })))).toEqual({ import_id: id, status: "confirmed" });
    expect(await t.db.account.count()).toBe(before);
  });
  it("rejects bad overrides, unmapped required fields, double mappings, and confirms only a preview", async () => {
    const { t, storage, id } = await started();
    const c = (o: unknown[]) => handle(ctx(t, storage, "thanasis", { import_id: id, mapping_overrides: o }));
    expect(errCode(await c([{ source_column: "nope", target_field: "name" }]))).toBe("validation_failed");
    expect(errCode(await c([{ source_column: "Πόλη", target_field: "price" }]))).toBe("validation_failed");
    expect(errCode(await c([{ source_column: "Επωνυμία", target_field: null }]))).toBe("validation_failed");
    expect(errCode(await c([{ source_column: "Πόλη", target_field: "name" }]))).toBe("validation_failed");
    expect((await t.db.data_import.require(id)).status).toBe("preview");
    await t.db.data_import.update(id, { status: "mapping" });
    expect(errCode(await c([]))).toBe("conflict");
  });
  it("forbidden for reps/managers and another org's import is not found; a spoofed caller is ignored", async () => {
    const { t, storage, id } = await started();
    expect(errCode(await handle(ctx(t, storage, "nikos", { import_id: id, mapping_overrides: [] })))).toBe("forbidden");
    expect(errCode(await handle(ctx(t, storage, "eleni", { import_id: id, mapping_overrides: [] })))).toBe("forbidden");
    expect(errCode(await handle(ctx(t, storage, "thanasis", { import_id: "00000000-0000-4000-8000-000000000000", mapping_overrides: [] })))).toBe("not_found");
    expect(ok(await handle(ctx(t, storage, "thanasis", { import_id: id, mapping_overrides: [], caller: { user_id: IDS.nikos } }))).status).toBe("imported");
  });

  it("functions/import-confirm/handler.gen.js is the current bundle (run `pnpm bundle import-confirm` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "import-confirm", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("import-confirm"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
