import { describe, expect, it } from "vitest";
import { mockClient, screenOf } from "../settings/testkit";
import {
  bytesToBase64, canApply, CONFIRM_BELOW, demoMapping, duplicateTargets, isReady, parseCsv, parseImport, pendingConfirmations, toOverrides,
  type Mapping,
} from "./model";

const ms: Mapping[] = [
  { source_column: "Επωνυμία", target_field: "name", confidence: 0.97, confirmed: false },
  { source_column: "ΑΦΜ", target_field: "vat_number", confidence: 0.55, confirmed: false },
  { source_column: "Σχόλια", target_field: null, confidence: 0.2, confirmed: false },
];

describe("import model", () => {
  it("REQ-IMP-001: columns under 0.6 must be confirmed before apply", () => {
    expect(CONFIRM_BELOW).toBe(0.6);
    expect(pendingConfirmations(ms, {}).map((m) => m.source_column)).toEqual(["ΑΦΜ", "Σχόλια"]);
    expect(canApply(ms, {})).toBe(false);
    const edits = { "ΑΦΜ": { target_field: "vat_number", confirmed: true }, "Σχόλια": { target_field: null, confirmed: true } };
    expect(canApply(ms, edits)).toBe(true);
    expect(toOverrides("i1", ms, edits)).toEqual({
      import_id: "i1",
      mapping_overrides: [
        { source_column: "ΑΦΜ", target_field: "vat_number", confirmed: true },
        { source_column: "Σχόλια", target_field: null, confirmed: true },
      ],
    });
  });
  it("blocks two columns on one field", () => {
    const edits = { "ΑΦΜ": { target_field: "name", confirmed: true }, "Σχόλια": { target_field: null, confirmed: true } };
    expect(duplicateTargets(ms, edits)).toEqual(["name"]);
    expect(canApply(ms, edits)).toBe(false);
  });
  it("parses import-get loosely", () => {
    const v = parseImport({ import: { status: "preview", rows_total: 200 }, mapping: [{ source_column: "a", target_field: "name", confidence: 0.9, confirmed: false }, {}], issues: [{ row_no: 4, issue_type: "invalid_vat" }, {}], preview_rows: [{}, { a: 1 }] });
    expect(v).toMatchObject({ status: "preview", rows_total: 200, issues: [{ row_no: 4, issue_type: "invalid_vat", detail: "" }], preview: [{ a: 1 }] });
    expect(isReady(v)).toBe(true);
    expect(isReady(parseImport({ import: { status: "mapping" }, mapping: [], issues: [], preview_rows: [] }))).toBe(false);
  });
  it("reads messy CSV (semicolons, quotes, CRLF, blank lines)", () => {
    const csv = 'Επωνυμία;ΑΦΜ;"Διεύθυνση, οδός"\r\n"Lofos ""Bakery""";094000000;Λόφου 3\r\n\r\nMiltos;;Αγ. Νικολάου 1\r\n';
    const r = parseCsv(csv);
    expect(r.headers).toEqual(["Επωνυμία", "ΑΦΜ", "Διεύθυνση, οδός"]);
    expect(r.rows).toEqual([['Lofos "Bakery"', "094000000", "Λόφου 3"], ["Miltos", "", "Αγ. Νικολάου 1"]]);
  });
  it("demo mapping (mock mode) scores exact, synonym and unknown columns", () => {
    const m = demoMapping(["name", "ΑΦΜ", "Τ.Κ.", "Notes"], "accounts");
    expect(m.map((x) => [x.target_field, x.confidence])).toEqual([["name", 0.95], ["vat_number", 0.7], ["postal_code", 0.7], [null, 0.3]]);
    expect(pendingConfirmations(m, {})).toHaveLength(1);
  });
  it("base64 of bytes", () => {
    expect(bytesToBase64(new TextEncoder().encode("a,b\n1,2"))).toBe("YSxiCjEsMg==");
  });
  it("start -> get -> confirm with only the screen's functions", async () => {
    const { client, calls } = mockClient(screenOf("/mgmt/import"));
    const s = await client.call("import-start", { data_type: "accounts", filename: "shops.csv", csv_base64: bytesToBase64(new TextEncoder().encode("name\nA")), is_baseline: false });
    parseImport(await client.call("import-get", { import_id: s.import_id }));
    await client.call("import-confirm", toOverrides(s.import_id, ms, {}));
    expect(calls).toEqual(["import-start", "import-get", "import-confirm"]);
  });
});
