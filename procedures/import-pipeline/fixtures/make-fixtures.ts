// Deterministic "messy ERP export" fixtures for REQ-IMP-001/002 (WP-IMP-01):
//   messy-accounts-200.csv   semicolon CSV, Greek headers, a title row, mixed phone/VAT/postal formats, duplicates
//   messy-accounts-200.xlsx  the same sheet as a real .xlsx (shared strings, deflate)
//   baseline-orders.csv      historical orders of seeded customers (REQ-IMP-003 baseline import)
// Run: node --experimental-strip-types procedures/import-pipeline/fixtures/make-fixtures.ts
// Every planted problem is listed in EXPECTED so tests can check the issue report row by row.
import { writeFileSync } from "node:fs";
import { deflateRawSync, crc32 } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HEADERS = ["Κωδ. Πελάτη", "Επωνυμία", "Α.Φ.Μ.", "Διεύθυνση", "Τ.Κ.", "Πόλη", "Τηλέφωνο", "e-mail", "Κατηγορία", "Πωλητής", "Σημειώσεις"];
const CATS = ["Café", "Bakery", "Mini market", "Restaurant", "Hotel"];
const PCS = ["15231", "152 32", "15233", "15234", "15124", "15125"];
const CITY = ["Χαλάνδρι", "Χαλάνδρι", "Χαλάνδρι", "Χαλάνδρι", "Μαρούσι", "Μαρούσι"];
const REPS = ["nikos@merc-demo.example", "Dimitra Pappa", "", "NIKOS@merc-demo.example"];

export interface Planted { row: number; issue: string }
export function messyAccounts(): { grid: string[][]; expected: Planted[] } {
  const grid: string[][] = [["Πελατολόγιο 2026 - εξαγωγή ERP (εμπιστευτικό)"], [], HEADERS];
  const expected: Planted[] = [];
  for (let i = 1; i <= 200; i++) {
    const rowNo = grid.length + 1; // spreadsheet row number of this row
    const n = String(i).padStart(3, "0");
    let vat = [`EL ${900100000 + i}`, `${900100000 + i}`.replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3"), `${900100000 + i}`][i % 3]!;
    let phone = [`210 ${6100000 + i}`, `+30 210-${6200000 + i}`, `0030 6944 ${100000 + i}`, `69${44000000 + i}`][i % 4]!;
    let pc = PCS[i % PCS.length]!;
    let street = `Οδός Δοκιμής ${i}`;
    let name = `Δοκιμαστικό Κατάστημα ${n}`;
    // planted problems
    if (i === 7 || i === 77) { vat = "12345"; expected.push({ row: rowNo, issue: "invalid_vat" }); }
    if (i === 13 || i === 113 || i === 150) { phone = "123"; expected.push({ row: rowNo, issue: "invalid_phone" }); }
    if (i === 21) { pc = "99999"; expected.push({ row: rowNo, issue: "invalid_address" }); }
    if (i === 22) { pc = ""; street = `Οδός Δοκιμής 22, 15232 Χαλάνδρι`; } // postal code inside the address: cleaned, no issue
    if (i === 30 || i === 130) { name = ""; expected.push({ row: rowNo, issue: "missing_required" }); }
    if (i === 40) { vat = "800000000"; expected.push({ row: rowNo, issue: "duplicate" }); }           // seeded Café Miltos
    if (i === 41) { vat = "EL800007919"; expected.push({ row: rowNo, issue: "duplicate" }); }          // seeded Bistro Lofos
    if (i === 60) { vat = `${900100000 + 59}`; expected.push({ row: rowNo, issue: "duplicate" }); }    // same VAT as row of i=59
    grid.push([`C-${10000 + i}`, name, vat, street, pc, CITY[i % CITY.length]!, phone, i % 5 === 0 ? "" : `shop${n}@example.gr`, CATS[i % CATS.length]!, REPS[i % REPS.length]!, i % 9 === 0 ? "πληρώνει μετρητοίς" : ""]);
    if (i === 100) grid.push([]); // a blank row in the middle
  }
  return { grid, expected };
}

export function baselineOrders(): string[][] {
  // seeded customers by ERP code; dates inside the seeded baseline window (demo day minus 120..30 days)
  const rows: string[][] = [["Αρ. Παραστατικού", "Πελάτης", "Ημερομηνία", "Κωδ. Είδους", "Ποσότητα", "Τιμή"]];
  const customers = ["ERP-1000", "ERP-1001", "ERP-1002"];
  const skus = ["ESP-CL-1", "FIL-1", "GRK-500"];
  for (let k = 0; k < 6; k++) {
    const day = String(3 + k * 4).padStart(2, "0");
    for (let l = 0; l < 2; l++) rows.push([`INV-B${100 + k}`, customers[k % 3]!, `${day}/08/2026`, skus[(k + l) % 3]!, String(5 + l * 3), l ? "4,50" : ""]);
  }
  return rows;
}

const csvCell = (c: string, d: string) => (/["\n\r]/.test(c) || c.includes(d) ? `"${c.replace(/"/g, '""')}"` : c);
export const toCsv = (grid: string[][], d = ";") => grid.map((r) => r.map((c) => csvCell(c, d)).join(d)).join("\r\n") + "\r\n";

// ---- minimal xlsx writer (shared strings; good enough for Excel, LibreOffice and our parser)
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
export function toXlsx(grid: string[][]): Buffer {
  const strings: string[] = [];
  const idx = new Map<string, number>();
  const sid = (s: string) => { if (!idx.has(s)) { idx.set(s, strings.length); strings.push(s); } return idx.get(s)!; };
  const rows = grid.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => (c === "" ? "" : `<c r="${colName(ci)}${ri + 1}" t="s"><v>${sid(c)}</v></c>`)).join("")}</row>`).join("");
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Πελάτες" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
  };
  files["xl/sharedStrings.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`;
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8"), comp = deflateRawSync(raw), nameB = Buffer.from(name, "utf8"), crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameB.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameB, comp); centrals.push(ch, nameB);
    offset += 30 + nameB.length + comp.length;
  }
  const cd = Buffer.concat(centrals), n = Object.keys(files).length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = dirname(fileURLToPath(import.meta.url));
  const { grid, expected } = messyAccounts();
  writeFileSync(join(dir, "messy-accounts-200.csv"), toCsv(grid));
  writeFileSync(join(dir, "messy-accounts-200.xlsx"), toXlsx(grid));
  writeFileSync(join(dir, "messy-accounts-200.expected.json"), JSON.stringify(expected, null, 2) + "\n");
  writeFileSync(join(dir, "baseline-orders.csv"), toCsv(baselineOrders(), ","));
  console.log(`wrote fixtures to ${dir}: 200 account rows, ${expected.length} planted issues`);
}
