import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import {
  handle, makeImpl, analyzeImport, cleanPhone, cleanVat, cleanPostal, splitAddress, parseDate, parseNumber, toMinor, parseFile, parseXlsx,
  heuristicMapping, mergeMappings, deAccent, safeFilename, mapColumns, toSheet, splitCsv, detectDelimiter, decodeText, CONFIRM_BELOW, type StorageLike,
} from "../src/import-analyze";
import { messyAccounts, toCsv, toXlsx } from "../../../procedures/import-pipeline/fixtures/make-fixtures";

export function fakeStorage(init: Record<string, Uint8Array> = {}) {
  const files = new Map(Object.entries(init));
  const storage: StorageLike & { files: Map<string, Uint8Array> } = {
    files,
    upload: async (k, d) => { if (files.has(k)) throw new Error("validation-error: key in use"); files.set(k, d); return { key: k }; },
    download: async (k) => { const d = files.get(k); if (!d) throw new Error("not-found"); return { data: d, contentType: "text/csv" }; },
    exists: async (k) => files.has(k),
  };
  return storage;
}
const enc = (s: string) => new TextEncoder().encode(s);

async function seedImport(t: ReturnType<typeof kit>, csv: Uint8Array, dataType = "accounts", name = "file.csv") {
  const imp = await t.db.data_import.insert({ uploaded_by: IDS.thanasis, data_type: dataType, status: "uploaded", is_baseline: false, file_ref: null } as any);
  const key = `merc/imports/${imp.id}/${name}`;
  const storage = fakeStorage({ [key]: csv });
  return { imp: await t.db.data_import.update(imp.id, { file_ref: key }), storage };
}

describe("import cleaning rules (REQ-IMP-002)", () => {
  it("phones become E.164 (+30 default), garbage is rejected", () => {
    expect(cleanPhone("210 6100004")).toBe("+302106100004");
    expect(cleanPhone("+30 210-6200001")).toBe("+302106200001");
    expect(cleanPhone("0030 6944 100002")).toBe("+306944100002");
    expect(cleanPhone("6944000003")).toBe("+306944000003");
    expect(cleanPhone("(210) 61.00.004")).toBe("+302106100004");
    expect(cleanPhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(cleanPhone("123")).toBeNull();
    expect(cleanPhone("+30 12345")).toBeNull();
  });
  it("VAT: EL/GR prefix and separators stripped, 9 digits", () => {
    expect(cleanVat("EL 900100003")).toBe("900100003");
    expect(cleanVat("900.100.001")).toBe("900100001");
    expect(cleanVat("GR800007919")).toBe("800007919");
    expect(cleanVat("12345678")).toBe("012345678");
    expect(cleanVat("12345")).toBeNull();
  });
  it("addresses: postal code split out of the street line; dates and money in Greek formats", () => {
    expect(splitAddress("Οδός Δοκιμής 22, 15232 Χαλάνδρι")).toEqual({ street: "Οδός Δοκιμής 22", postal: "15232", city: "Χαλάνδρι" });
    expect(splitAddress("Odos 10")).toEqual({ street: "Odos 10", postal: null, city: null });
    expect(cleanPostal("152 32")).toBe("15232");
    expect(cleanPostal("TK 15231")).toBe("15231");
    expect(parseDate("03/08/2026")).toBe("2026-08-03");
    expect(parseDate("2026-08-03")).toBe("2026-08-03");
    expect(parseDate("3.8.26")).toBe("2026-08-03");
    expect(parseDate("46237")).toBe("2026-08-03");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseNumber("1.234,50")).toBe(1234.5);
    expect(parseNumber("1,234.50")).toBe(1234.5);
    expect(toMinor("€ 18,90")).toBe(1890);
    expect(toMinor("4.5")).toBe(450);
  });
});

describe("file parsing", () => {
  it("detects ; , and tab delimiters, quoted cells, BOM and Windows-1253", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(splitCsv('a,"b, c","say ""hi"""\r\n1,2,3', ",")).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe("A");
    expect(decodeText(new Uint8Array([0xe1, 0xe2]))).toBe("αβ"); // cp1253
  });
  it("skips title rows and blank rows; row numbers are spreadsheet rows", async () => {
    const { grid } = messyAccounts();
    const sheet = await parseFile(enc(toCsv(grid)));
    expect(sheet.headers[0]).toBe("Κωδ. Πελάτη");
    expect(sheet.rows).toHaveLength(200);
    expect(sheet.firstRowNo).toBe(4);
    const s2 = toSheet([["Title"], [], ["a", "b", ""], ["1", "2", ""], ["", "", ""], ["3", "4", ""]]);
    expect(s2.headers).toEqual(["a", "b"]);
    expect(s2.rows).toEqual([["1", "2"], ["3", "4"]]);
  });
  it("reads a real .xlsx (zip + deflate, shared strings) to the same sheet as the CSV", async () => {
    const { grid } = messyAccounts();
    const fromX = await parseFile(new Uint8Array(toXlsx(grid)), "x.xlsx");
    const fromC = await parseFile(enc(toCsv(grid)));
    expect(fromX.headers).toEqual(fromC.headers);
    expect(fromX.rows).toEqual(fromC.rows);
    expect((await parseXlsx(new Uint8Array(toXlsx([["a", "b"], ["1", "2"]]))))).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("old .xls and headerless files fail with a clear message", async () => {
    expect(errCode(await parseFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0, 0])).catch((e) => ({ error: e })))).toBe("validation_failed");
    await expect(parseFile(enc("\n\n"))).rejects.toThrow(/no header/);
  });
});

describe("column mapping (REQ-IMP-001)", () => {
  it("the messy 200-row ERP export maps correctly with at most 2 confirmations, even without the model", async () => {
    const sheet = await parseFile(enc(toCsv(messyAccounts().grid)));
    const { mapping, model } = await mapColumns("accounts", sheet, { useModel: false });
    expect(model).toBeNull();
    const m = Object.fromEntries(mapping.map((x) => [x.source_column, x.target_field]));
    expect(m).toEqual({
      "Κωδ. Πελάτη": "external_ref", "Επωνυμία": "name", "Α.Φ.Μ.": "vat_number", "Διεύθυνση": "street", "Τ.Κ.": "postal_code", "Πόλη": "city",
      "Τηλέφωνο": "phone", "e-mail": "email", "Κατηγορία": "category", "Πωλητής": "rep", "Σημειώσεις": null,
    });
    expect(mapping.filter((x) => x.confidence < CONFIRM_BELOW).length).toBeLessThanOrEqual(2);
  });
  it("works without String.prototype.normalize and TextDecoder (the Functions runtime lacks normalize)", async () => {
    const orig = String.prototype.normalize;
    const TD = globalThis.TextDecoder;
    (String.prototype as any).normalize = undefined;
    (globalThis as any).TextDecoder = undefined;
    try {
      const sheet = await parseFile(enc(toCsv(messyAccounts().grid)));
      const { mapping } = await mapColumns("accounts", sheet, { useModel: false });
      expect(mapping.find((m) => m.source_column === "Τηλέφωνο")).toMatchObject({ target_field: "phone", confidence: 0.95 });
      expect(mapping.filter((x) => x.confidence < CONFIRM_BELOW).length).toBeLessThanOrEqual(2);
      expect(deAccent("Καφέ Μίλτος Ελληνικός ΐ café")).toBe("Καφε Μιλτος Ελληνικος ι cafe");
      expect(safeFilename("Πελάτες ERP.csv")).toBe("Pelates_ERP.csv");
      expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0xce, 0xb1, 0x41]))).toBe("αA");
      expect(decodeText(new Uint8Array([0xc1, 0xe8, 0xde, 0xed, 0xe1]))).toBe("Αθήνα"); // cp1253
      const x = await parseFile(new Uint8Array(toXlsx(messyAccounts().grid)), "x.xlsx");
      expect(x.headers[1]).toBe("Επωνυμία");
    } finally { String.prototype.normalize = orig; (globalThis as any).TextDecoder = TD; }
  });
  it("uses the import_mapping model for uncertain columns and keeps strong header matches", async () => {
    const sheet = toSheet([["Shop", "Αφμ", "Col X", "notes"], ["Café A", "900100001", "+30 210 6100001", "x"], ["Café B", "900100002", "+30 210 6100002", "y"]]);
    const calls: unknown[] = [];
    const model = () => ({ withStructuredOutput: () => ({ invoke: async (msgs: unknown[]) => { calls.push(msgs); return { mappings: [
      { source_column: "Shop", target_field: "name", confidence: 0.9 }, { source_column: "Αφμ", target_field: "phone", confidence: 0.4 },
      { source_column: "Col X", target_field: "phone", confidence: 0.8 }, { source_column: "notes", target_field: null, confidence: 0.9 },
    ] }; } }) });
    const { mapping, model: used } = await mapColumns("accounts", sheet, { model });
    expect(calls).toHaveLength(1);
    expect(used).toBeTruthy();
    const m = Object.fromEntries(mapping.map((x) => [x.source_column, x]));
    expect(m["Αφμ"]!.target_field).toBe("vat_number"); // exact header synonym wins over the model
    expect(m["Shop"]!).toMatchObject({ target_field: "name" });
    expect(m["Col X"]!.target_field).toBe("phone");
    expect(m["Col X"]!.confidence).toBeGreaterThanOrEqual(0.6);
    expect(m["notes"]!).toMatchObject({ target_field: null });
    expect(m["notes"]!.confidence).toBeGreaterThanOrEqual(CONFIRM_BELOW);
  });
  it("a model failure falls back to the heuristic; two columns on one field leave the weaker one to confirm", async () => {
    const sheet = toSheet([["Name", "Company", "foo"], ["a", "b", "c"], ["d", "e", "f"]]);
    const broken = () => ({ withStructuredOutput: () => ({ invoke: async () => { throw new Error("model down"); } }) });
    const { mapping, model } = await mapColumns("accounts", sheet, { model: broken });
    expect(model).toBeNull();
    expect(mapping.find((x) => x.source_column === "Name")).toMatchObject({ target_field: "name", confidence: 0.95 });
    expect(mapping.find((x) => x.source_column === "Company")!.confidence).toBeLessThan(CONFIRM_BELOW);
    expect(mergeMappings("accounts", heuristicMapping("accounts", sheet), null)).toEqual(mapping);
  });
});

describe("fn:import-analyze (procedure step)", () => {
  it("maps, cleans and reports each planted bad row with its reason; status preview", async () => {
    const t = kit();
    const { grid, expected } = messyAccounts();
    const { imp, storage } = await seedImport(t, enc(toCsv(grid)));
    const ctx = Object.assign(t.fnCtx(null, { import_id: imp.id, caller: { user_id: IDS.nikos } }), { storage });
    const r = ok(await handle(ctx as any));
    expect(validateResponse("import-analyze", r).ok).toBe(true);
    expect(r.status).toBe("preview");
    expect(r.rows_total).toBe(200);
    const issues = await t.db.import_row_issue.all({ import_id: imp.id });
    expect(r.issues).toBe(issues.length);
    for (const e of expected) expect(issues.some((x) => x.row_no === e.row && x.issue_type === e.issue), `row ${e.row} ${e.issue}`).toBe(true);
    expect(issues.find((x) => x.issue_type === "duplicate" && /Café Miltos/.test(x.detail ?? ""))).toBeTruthy();
    expect(issues.every((x) => !!x.detail)).toBe(true);
    const row22 = 3 + 22 + 0; // row 22 (postal code inside the address) has no address issue
    expect(issues.some((x) => x.row_no === row22 + 0 && x.issue_type === "invalid_address")).toBe(false);
    const mapping = await t.db.import_column_mapping.all({ import_id: imp.id });
    expect(mapping).toHaveLength(11);
    expect(mapping.filter((m) => !m.confirmed).length).toBeLessThanOrEqual(2);
    const after = await t.db.data_import.require(imp.id);
    expect(after).toMatchObject({ status: "preview", rows_total: 200 });
    expect(after.rows_with_issues).toBe(new Set(issues.map((x) => x.row_no)).size);
  });
  it("is re-runnable (replaces mapping and issues) and leaves a confirmed import alone", async () => {
    const t = kit();
    const { imp, storage } = await seedImport(t, enc("name;vat\nA;1\nB;900100001\n"));
    const impl = makeImpl({ storage, useModel: false });
    const sys = await t.system("procedure");
    const a = await impl({ req: { import_id: imp.id }, db: t.db, me: sys, platform: t.platform });
    const b = await impl({ req: { import_id: imp.id }, db: t.db, me: sys, platform: t.platform });
    expect(b).toEqual(a);
    expect(await t.db.import_column_mapping.count({ import_id: imp.id })).toBe(2);
    expect(await t.db.import_row_issue.count({ import_id: imp.id })).toBe(1);
    await t.db.data_import.update(imp.id, { status: "confirmed" });
    expect((await impl({ req: { import_id: imp.id }, db: t.db, me: sys, platform: t.platform })).status).toBe("confirmed");
  });
  it("unknown import -> not_found; missing storage -> blocked naming context.storage; unreadable file -> failed", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx(null, { import_id: "00000000-0000-4000-8000-000000000000" }) as any))).toBe("not_found");
    const { imp } = await seedImport(t, enc("a;b\n1;2"));
    const out = await analyzeImport(t.db, imp, { storage: null }).catch((e) => e);
    expect(out.code).toBe("blocked_by_policy");
    expect(out.details.missing).toBe("context.storage");
    expect((await t.db.data_import.require(imp.id)).status).toBe("failed");
    expect(validateRequest("import-analyze", { import_id: imp.id }).ok).toBe(true);
  });

  it("functions/import-analyze/handler.gen.js is the current bundle (run `pnpm bundle import-analyze` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "import-analyze", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("import-analyze"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
