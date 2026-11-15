// fn:import-analyze (contracts/functions/import-analyze.json, REQ-IMP-001 / REQ-IMP-002). Procedure step of
// import-pipeline (and the inline fallback of fn:import-start). Also the shared import library (WP-IMP-01) that
// import-start / import-get / import-confirm / import-apply use, so every rule lives once (REQ-CORE-004):
//   - file:     the upload is kept in Custom Storage (context.storage) under merc/imports/<import_id>/<filename>;
//               CSV/TSV/semicolon text (UTF-8, BOM, Windows-1253) or .xlsx (first sheet, parsed without libraries);
//   - header:   messy sheets with title rows: the header is the first row that is "wide enough";
//   - mapping:  each column -> a Merc target field with a confidence 0-1. A deterministic synonym/value sniffer
//               (Greek + English headers) runs first; the import_mapping LLM schema (profile merc-extract) maps the
//               rest. confidence < 0.6 means "ask the admin to confirm" (import_column_mapping.confirmed = false);
//   - cleaning: phones to E.164 (+30 default), VAT to 9 digits (EL/GR prefix stripped), postal codes to known
//               postal areas, addresses split "street, 15231 city", dates (ISO, d/m/y, Excel serials), money to minor;
//   - issues:   one import_row_issue per problem (duplicate, invalid_vat, invalid_phone, invalid_address,
//               missing_required, unknown_reference) with the reason. Blocking issues skip the row on apply.
import {
  createDb, notFound, invalid, blocked, isMercError, type Db, type FunctionContext, type Impl, type Principal, type Row, type TablesApi,
} from "../../core/src/index";
import { callStructured, type ModelFactory } from "../../llm/src/index";
import { defineSystemFunction } from "./candidate-get";

export const SLUG = "import-analyze" as const;
export const STORAGE_PREFIX = "merc/imports/";
export const CONFIRM_BELOW = 0.6;
/** Rows shown by fn:import-get as the preview. */
export const PREVIEW_ROWS = 20;
/** Sample rows sent to the mapping model. */
export const SAMPLE_ROWS = 5;
export const MAX_ROWS = 5000;

export type DataType = "accounts" | "contacts" | "orders" | "products" | "visits";
export type IssueType = "duplicate" | "invalid_vat" | "invalid_phone" | "invalid_address" | "missing_required" | "unknown_reference";
/** Blocking issues skip the row on apply; the others import the row with the bad value cleared. */
export const BLOCKING: ReadonlySet<IssueType> = new Set(["duplicate", "missing_required", "unknown_reference"]);

const log = (m: string) => console.log(`[import] ${m}`);
const msg = (e: unknown) => String((e as { message?: unknown })?.message ?? e).slice(0, 300);

// ===================================================================== storage
export interface StorageLike {
  upload(key: string, data: Uint8Array, contentType?: string): Promise<{ key: string }> | { key: string };
  download(key: string): Promise<{ data: Uint8Array; contentType?: string }> | { data: Uint8Array; contentType?: string };
  exists?(key: string): Promise<boolean> | boolean;
}
export const storageOf = (c: unknown): StorageLike | null => {
  const s = (c as { storage?: StorageLike } | null)?.storage;
  return s && typeof s.upload === "function" && typeof s.download === "function" ? s : null;
};
// The Functions runtime has no String.prototype.normalize (seen on dev), so accents are stripped by table.
const ACCENTED: Record<string, string> = Object.fromEntries([
  ["άἀἁ", "α"], ["έ", "ε"], ["ή", "η"], ["ίϊΐ", "ι"], ["ό", "ο"], ["ύϋΰ", "υ"], ["ώ", "ω"], ["ΆΑ", "Α"], ["Έ", "Ε"], ["Ή", "Η"], ["ΊΪ", "Ι"], ["Ό", "Ο"], ["ΎΫ", "Υ"], ["Ώ", "Ω"],
  ["àáâãäå", "a"], ["ç", "c"], ["èéêë", "e"], ["ìíîï", "i"], ["ñ", "n"], ["òóôõö", "o"], ["ùúûü", "u"], ["ýÿ", "y"],
  ["ÀÁÂÃÄÅ", "A"], ["Ç", "C"], ["ÈÉÊË", "E"], ["ÌÍÎÏ", "I"], ["Ñ", "N"], ["ÒÓÔÕÖ", "O"], ["ÙÚÛÜ", "U"], ["Ý", "Y"],
].flatMap(([from, to]) => [...from!].map((c) => [c, to!])));
/** Remove diacritics (Greek tonos/dialytika, common Latin accents) without String.prototype.normalize. */
export const deAccent = (s: string): string => {
  let out = "";
  for (const ch of s) { const code = ch.charCodeAt(0); if (code >= 0x300 && code <= 0x36f) continue; out += ACCENTED[ch] ?? ch; }
  return out;
};
const GREEK: Record<string, string> = Object.fromEntries([..."αβγδεζηθικλμνξοπρσςτυφχψω"].map((c, i) => [c, ["a", "v", "g", "d", "e", "z", "i", "th", "i", "k", "l", "m", "n", "x", "o", "p", "r", "s", "s", "t", "y", "f", "ch", "ps", "o"][i]!]));
/** Storage-safe file name (Greek transliterated, other characters to _). */
export const safeFilename = (name: string): string => {
  const base = String(name).split(/[\\/]/).pop() ?? "upload";
  const latin = [...deAccent(base)].map((ch) => { const l = GREEK[ch.toLowerCase()]; return l === undefined ? ch : ch === ch.toLowerCase() ? l : l.toUpperCase(); }).join("");
  const clean = latin.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/\.{2,}/g, ".").replace(/^[._-]+/, "");
  return (clean || "upload.csv").slice(0, 120);
};
export const storageKey = (importId: string, filename: string) => `${STORAGE_PREFIX}${importId}/${safeFilename(filename)}`;
export const filenameOf = (fileRef: string | null | undefined) => (fileRef ? fileRef.split("/").pop() ?? fileRef : null);
export const blockedStorage = (fn: string) => blocked(`${fn} is blocked: Custom Storage (context.storage) is not available to this function`, {
  missing: "context.storage", kind: "platform", how: "Custom Storage must be enabled for Wonderful Functions in this workspace (Resources -> Storage).",
});

export async function readFile(storage: StorageLike | null, imp: Row<"data_import">, fn: string): Promise<Uint8Array> {
  if (!imp.file_ref) throw invalid("the import has no file", { import_id: imp.id });
  if (!storage) throw blockedStorage(fn);
  try { return (await storage.download(imp.file_ref)).data; }
  catch (e) { throw notFound(`import file ${imp.file_ref} could not be read: ${msg(e)}`, { file_ref: imp.file_ref }); }
}

// ===================================================================== base64 / text
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Base64 (std or url-safe, optional data: prefix) to bytes without Node built-ins. Null if malformed. */
export function decodeBase64(input: string): Uint8Array | null {
  let s = input.trim();
  const comma = s.startsWith("data:") ? s.indexOf(",") : -1;
  if (comma >= 0) s = s.slice(comma + 1);
  s = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!s || s.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(s)) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    buf = (buf << 6) | B64.indexOf(s[i]!);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 0xff; }
  }
  return out.subarray(0, o);
}

/** Strict UTF-8 decoder without TextDecoder (the Functions runtime may lack it). Null on invalid UTF-8. */
export function utf8(bytes: Uint8Array, strict = true): string | null {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    let cp = -1, n = 0;
    if (b < 0x80) { cp = b; n = 1; }
    else if (b >= 0xc2 && b < 0xe0) { cp = b & 0x1f; n = 2; }
    else if (b >= 0xe0 && b < 0xf0) { cp = b & 0x0f; n = 3; }
    else if (b >= 0xf0 && b < 0xf5) { cp = b & 0x07; n = 4; }
    if (cp >= 0 && i + n <= bytes.length) {
      for (let k = 1; k < n; k++) { const c = bytes[i + k]!; if ((c & 0xc0) !== 0x80) { cp = -1; break; } cp = (cp << 6) | (c & 0x3f); }
    } else cp = -1;
    if (cp < 0 || (n === 3 && cp < 0x800) || (n === 4 && (cp < 0x10000 || cp > 0x10ffff))) { if (strict) return null; out += "\uFFFD"; i++; continue; }
    out += String.fromCodePoint(cp);
    i += n;
  }
  return out;
}
/** Windows-1253 (Greek Excel CSV export) to text. */
export function cp1253(bytes: Uint8Array): string {
  const hi: Record<number, string> = { 0x80: "€", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x96: "–", 0x97: "—", 0xa2: "Ά", 0xb4: "΄", 0xb5: "µ", 0xb6: "¶", 0xb8: "Έ", 0xb9: "Ή", 0xba: "Ί", 0xbc: "Ό", 0xbe: "Ύ", 0xbf: "Ώ" };
  let out = "";
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : hi[b] ?? (b >= 0xc0 && b !== 0xd2 && b !== 0xff ? String.fromCharCode(0x0390 + (b - 0xc0)) : String.fromCharCode(b));
  return out;
}
/** Bytes to text: UTF-8 (BOM stripped); a Greek Excel CSV export (Windows-1253) when UTF-8 is invalid. */
export function decodeText(bytes: Uint8Array): string {
  const u = utf8(bytes);
  return u !== null ? u.replace(/^\uFEFF/, "") : cp1253(bytes);
}

// ===================================================================== CSV
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ",", bestScore = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = lines.map((l) => splitCsv(l, d)[0]?.length ?? 1);
    const score = counts.reduce((a, b) => a + b, 0) - (counts.length ? Math.max(...counts) - Math.min(...counts) : 0);
    if (score > bestScore && Math.max(...counts, 1) > 1) { best = d; bestScore = score; }
  }
  return best;
}

/** RFC 4180-ish: quoted fields, doubled quotes, newlines inside quotes. */
export function splitCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") { q = true; cell = ""; }
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ===================================================================== XLSX (zip + deflate-raw, first sheet)
const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
export const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
export const isOle = (b: Uint8Array) => b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as unknown as { DecompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
  if (!DS) throw invalid("this runtime cannot read .xlsx files (no DecompressionStream): save the sheet as CSV and upload again");
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DS("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) { throw invalid(`this runtime cannot unpack .xlsx files (${String((e as Error)?.message ?? e).slice(0, 120)}): save the sheet as CSV and upload again`); }
}

export async function unzip(b: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw invalid("the .xlsx file is damaged (no zip directory)");
  const n = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = new Map<string, Uint8Array>();
  const dec = { decode: (b: Uint8Array) => utf8(b, false) ?? "" };
  for (let k = 0; k < n && u32(b, p) === 0x02014b50; k++) {
    const method = u16(b, p + 10), size = u32(b, p + 20), nameLen = u16(b, p + 28), extra = u16(b, p + 30), comment = u16(b, p + 32), local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    if (!wanted(name)) continue;
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    const raw = b.subarray(start, start + size);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    else throw invalid(`the .xlsx file uses an unsupported compression (${method})`);
  }
  return out;
}

const xmlText = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/** First worksheet of an .xlsx as rows of strings (shared strings, inline strings, numbers as written). */
export async function parseXlsx(bytes: Uint8Array): Promise<string[][]> {
  const files = await unzip(bytes, (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const dec = { decode: (b: Uint8Array) => utf8(b, false) ?? "" };
  const txt = (n: string) => (files.has(n) ? dec.decode(files.get(n)!) : "");
  let sheetPath = "xl/worksheets/sheet1.xml";
  const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(txt("xl/workbook.xml"))?.[1];
  if (rid) {
    const rel = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(txt("xl/_rels/workbook.xml.rels"))?.[1]
      ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(txt("xl/_rels/workbook.xml.rels"))?.[1];
    if (rel) sheetPath = rel.startsWith("/") ? rel.slice(1) : `xl/${rel.replace(/^\.\//, "")}`;
  }
  if (!files.has(sheetPath)) sheetPath = [...files.keys()].filter((k) => k.startsWith("xl/worksheets/")).sort()[0] ?? sheetPath;
  const sheet = txt(sheetPath);
  if (!sheet) throw invalid("the .xlsx file has no worksheet");
  const shared = [...txt("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1]!)).join(""));
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rNo = Number(/\br="(\d+)"/.exec(rm[1]!)?.[1] ?? rows.length + 1);
    const row: string[] = [];
    let next = 0;
    for (const cm of rm[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!, body = cm[2] ?? "";
      const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1];
      const ci = ref ? colIndex(ref) : next;
      next = ci + 1;
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val = "";
      if (t === "s" && v !== undefined) val = shared[Number(v)] ?? "";
      else if (t === "inlineStr") val = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => xmlText(x[1]!)).join("");
      else if (v !== undefined) val = xmlText(v);
      while (row.length < ci) row.push("");
      row[ci] = val;
    }
    while (rows.length < rNo - 1) rows.push([]);
    rows.push(row);
  }
  return rows;
}

// ===================================================================== table shape
export interface Sheet { headers: string[]; rows: string[][]; /** spreadsheet row number of rows[0] (1-based) */ firstRowNo: number }

/** Grid -> header + data rows. Skips title/blank rows above the header and blank rows below; names blank/duplicate headers. */
export function toSheet(grid: string[][]): Sheet {
  const cells = grid.map((r) => r.map((c) => String(c ?? "").trim()));
  const filled = (r: string[]) => r.filter((c) => c !== "").length;
  const widest = Math.max(0, ...cells.slice(0, 30).map(filled));
  let h = cells.findIndex((r, i) => i < 30 && filled(r) >= Math.max(2, Math.ceil(widest * 0.6)));
  if (h < 0) h = cells.findIndex((r) => filled(r) > 0);
  if (h < 0) return { headers: [], rows: [], firstRowNo: 1 };
  const raw = cells[h]!;
  let width = raw.length;
  for (const r of cells.slice(h + 1)) width = Math.max(width, r.length);
  const seen = new Map<string, number>();
  const headers: string[] = [];
  for (let i = 0; i < width; i++) {
    let name = (raw[i] ?? "").replace(/\s+/g, " ") || `column_${i + 1}`;
    const k = name.toLowerCase();
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n > 1) name = `${name} (${n})`;
    headers.push(name);
  }
  // keep empty data columns out (no header and no values)
  const rowsAll = cells.slice(h + 1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  const keep = headers.map((hd, i) => !/^column_\d+$/.test(hd) || rowsAll.some((r) => r[i] !== ""));
  const pick = <T>(a: T[]) => a.filter((_, i) => keep[i]);
  const rows: string[][] = [];
  const rowNos: number[] = [];
  rowsAll.forEach((r, i) => { if (r.some((c) => c !== "")) { rows.push(pick(r)); rowNos.push(h + 2 + i); } });
  const sheet: Sheet & { rowNos?: number[] } = { headers: pick(headers), rows, firstRowNo: h + 2 };
  sheet.rowNos = rowNos;
  return sheet;
}
export const rowNoOf = (s: Sheet, i: number): number => ((s as Sheet & { rowNos?: number[] }).rowNos?.[i] ?? s.firstRowNo + i);

/** Bytes (CSV/TSV text or .xlsx) to a sheet. */
export async function parseFile(bytes: Uint8Array, filename = ""): Promise<Sheet> {
  if (isOle(bytes) || /\.xls$/i.test(filename)) throw invalid("old .xls files are not supported: save the sheet as .xlsx or CSV and upload again");
  const grid = isZip(bytes) ? await parseXlsx(bytes) : (() => { const t = decodeText(bytes); return splitCsv(t, detectDelimiter(t)); })();
  const sheet = toSheet(grid);
  if (!sheet.headers.length) throw invalid("the file has no header row");
  if (sheet.rows.length > MAX_ROWS) throw invalid(`the file has ${sheet.rows.length} rows; the limit is ${MAX_ROWS}`);
  return sheet;
}

// ===================================================================== target fields
export interface FieldDef { field: string; description: string; required?: boolean; synonyms: string[] }
const F = (field: string, description: string, synonyms: string[], required = false): FieldDef => ({ field, description, synonyms, required });
const ACCOUNT_REF = F("account", "The customer this row belongs to: its name, VAT number (ΑΦΜ) or ERP code", ["account", "customer", "customer name", "account name", "company", "shop", "store", "business", "πελατης", "επωνυμια", "επιχειρηση", "καταστημα", "πελατης επωνυμια", "customer vat", "αφμ πελατη", "customer code", "κωδικος πελατη"], true);
const REP_REF = F("rep", "Sales rep responsible (email or full name)", ["rep", "sales rep", "salesperson", "salesman", "owner", "account owner", "rep email", "πωλητης", "υπευθυνος", "αντιπροσωπος"]);

export const TARGET_FIELDS: Record<DataType, FieldDef[]> = {
  accounts: [
    F("name", "Business / trade name of the customer", ["name", "account", "account name", "company", "company name", "business", "business name", "customer", "customer name", "shop", "store", "trade name", "επωνυμια", "ονομα", "πελατης", "επιχειρηση", "καταστημα", "διακριτικος τιτλος", "eponymia"], true),
    F("vat_number", "Greek VAT number (ΑΦΜ, 9 digits)", ["vat", "vat number", "vat no", "vat id", "afm", "αφμ", "α φ μ", "tax id", "tin", "tax number", "αριθμος φορολογικου μητρωου"]),
    F("street", "Street address (street and number); may include postal code and city", ["street", "address", "street address", "address line", "address 1", "addr", "οδος", "διευθυνση", "δνση", "οδος αριθμος", "διευθυνση καταστηματος"]),
    F("postal_code", "Greek postal code (5 digits)", ["postal code", "postcode", "zip", "zip code", "tk", "τκ", "τ κ", "ταχ κωδ", "ταχ κωδικας", "ταχυδρομικος κωδικας", "pc"]),
    F("city", "City or area (used to check the address, not stored)", ["city", "town", "area", "municipality", "πολη", "περιοχη", "δημος"]),
    F("phone", "Phone number", ["phone", "telephone", "tel", "phone number", "mobile", "cell", "τηλεφωνο", "τηλ", "κινητο", "τηλεφωνο επικοινωνιας"]),
    F("email", "Email address", ["email", "e mail", "mail", "email address", "ηλεκτρονικο ταχυδρομειο"]),
    F("website", "Website URL", ["website", "web", "site", "url", "web site", "ιστοσελιδα", "ιστοτοπος"]),
    F("category", "Account category name (Café, Bakery, Mini market, ...)", ["category", "type", "segment", "business type", "shop type", "κατηγορια", "ειδος", "τυπος"]),
    F("account_type", "customer, prospect or lost", ["account type", "status", "customer status", "κατασταση", "τυπος πελατη"]),
    F("external_ref", "ERP / customer code", ["id", "code", "customer code", "customer id", "account id", "erp code", "erp id", "ref", "κωδικος", "κωδικος πελατη", "κωδ", "κωδ πελατη"]),
    F("customer_since", "Date the account became a customer", ["customer since", "since", "first order", "start date", "πελατης απο", "ημερομηνια εναρξης"]),
    F("visit_frequency_days", "Target days between visits", ["visit frequency", "frequency", "visit every", "συχνοτητα", "συχνοτητα επισκεψεων"]),
    REP_REF,
  ],
  contacts: [
    ACCOUNT_REF,
    F("full_name", "Contact person full name", ["name", "full name", "contact", "contact name", "contact person", "person", "ονοματεπωνυμο", "υπευθυνος επικοινωνιας", "επαφη"], true),
    F("role_title", "Job title / role", ["role", "title", "job title", "position", "θεση", "ρολος", "ιδιοτητα"]),
    F("phone", "Phone number", ["phone", "telephone", "tel", "mobile", "cell", "τηλεφωνο", "τηλ", "κινητο"]),
    F("email", "Email address", ["email", "e mail", "mail"]),
    F("is_decision_maker", "Yes if this person decides purchases", ["decision maker", "decides", "is decision maker", "dm", "αποφασιζει"]),
    F("preferred_channel", "email, phone, whatsapp or viber", ["preferred channel", "channel", "contact via", "καναλι"]),
  ],
  products: [
    F("sku", "Product code / SKU", ["sku", "code", "product code", "item code", "κωδικος", "κωδικος ειδους", "κωδ ειδους"], true),
    F("name", "Product name", ["name", "product", "product name", "item", "description", "περιγραφη", "ειδος", "ονομα"], true),
    F("unit", "Unit: kg, piece, box, litre or pack", ["unit", "uom", "μοναδα", "μ μ", "μοναδα μετρησης"]),
    F("list_price", "List price in euro", ["price", "list price", "unit price", "τιμη", "τιμη καταλογου", "τιμη μοναδας"], true),
    F("category", "Product category name", ["category", "product category", "κατηγορια"]),
    F("active", "Yes if the product is sold", ["active", "enabled", "ενεργο"]),
  ],
  orders: [
    ACCOUNT_REF,
    F("order_ref", "Order / invoice number (rows with the same number form one order)", ["order", "order no", "order number", "order id", "invoice", "invoice no", "παραστατικο", "αρ παραστατικου", "αριθμος παραγγελιας", "παραγγελια"]),
    F("order_date", "Order date", ["date", "order date", "invoice date", "ημερομηνια", "ημ νια", "ημερομηνια παραγγελιας"], true),
    F("sku", "Product code / SKU", ["sku", "product code", "item code", "code", "κωδικος ειδους", "κωδ ειδους"], true),
    F("quantity", "Quantity", ["qty", "quantity", "units", "ποσοτητα", "τεμαχια"], true),
    F("unit_price", "Unit price in euro (defaults to the list price)", ["price", "unit price", "τιμη", "τιμη μοναδας"]),
    F("discount_pct", "Discount percent 0-100", ["discount", "discount %", "disc", "εκπτωση", "εκπτωση %"]),
    REP_REF,
  ],
  visits: [
    ACCOUNT_REF,
    F("planned_date", "Visit date", ["date", "visit date", "planned date", "ημερομηνια", "ημερομηνια επισκεψης"], true),
    F("status", "planned, done or skipped", ["status", "κατασταση"]),
    F("purpose", "Purpose of the visit", ["purpose", "reason", "σκοπος", "αιτια"]),
    F("outcome", "Outcome / notes", ["outcome", "notes", "result", "comments", "σχολια", "αποτελεσμα", "σημειωσεις"]),
    REP_REF,
  ],
};
export const targetFields = (t: DataType) => TARGET_FIELDS[t];
export const fieldNames = (t: DataType) => TARGET_FIELDS[t].map((f) => f.field);

// ===================================================================== normalizers
export const norm = (s: unknown): string => deAccent(String(s ?? "").toLowerCase()).replace(/ς/g, "σ")
  .replace(/[^\p{L}\p{N}%]+/gu, " ").trim().replace(/\s+/g, " ");
const normSyn = (s: string) => norm(s.replace(/ς/g, "σ"));

/** Phone to E.164. Greek numbers without a country code get +30. Null if it cannot be a phone. */
export function cleanPhone(raw: string): string | null {
  let s = raw.trim().replace(/^(tel|τηλ)\.?:?\s*/i, "").replace(/\s*(ext|εσωτ)\.?\s*\d+$/i, "");
  if (!s) return null;
  const plus = s.startsWith("+");
  let d = s.replace(/\D/g, "");
  if (!plus && d.startsWith("00")) d = d.slice(2);
  else if (!plus && d.length === 10 && /^(2|69)/.test(d)) d = `30${d}`;
  if (/^30/.test(d)) return d.length === 12 && /^30(2|69)/.test(d) ? `+${d}` : null;
  if ((plus || raw.trim().startsWith("00")) && d.length >= 8 && d.length <= 15) return `+${d}`;
  return null;
}
/** Greek VAT (ΑΦΜ): strip EL/GR prefix and separators; must be 9 digits (8-digit old numbers get a leading 0). */
export function cleanVat(raw: string): string | null {
  const d = raw.trim().replace(/^(el|gr)\s*/i, "").replace(/[\s.\-/]/g, "");
  if (/^\d{9}$/.test(d)) return d;
  if (/^\d{8}$/.test(d)) return `0${d}`;
  return null;
}
export const cleanPostal = (raw: string): string | null => {
  const d = raw.replace(/^(tk|τκ|t\.k\.|τ\.κ\.)\s*/i, "").replace(/\s/g, "");
  return /^\d{5}$/.test(d) ? d : null;
};
/** "Odos Café 10, 15231 Chalandri" -> street + postal code (+ city). */
export function splitAddress(raw: string): { street: string | null; postal: string | null; city: string | null } {
  const m = /(?:^|[\s,])(\d{3}\s?\d{2})(?=$|[\s,])/.exec(raw);
  if (!m) return { street: raw.trim() || null, postal: null, city: null };
  const before = raw.slice(0, m.index).replace(/[\s,]+$/, "").trim();
  const after = raw.slice(m.index + m[0].length).replace(/^[\s,]+/, "").trim();
  return { street: before || null, postal: m[1]!.replace(/\s/g, ""), city: after || null };
}
export const cleanEmail = (raw: string): string | null => { const s = raw.trim().toLowerCase().replace(/^mailto:/, ""); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null; };
export const cleanWebsite = (raw: string): string | null => {
  const s = raw.trim();
  if (!s || /\s/.test(s) || !/\.[a-z]{2,}/i.test(s)) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`;
};
/** Number from "1.234,50", "18,90", "€ 18.90", "1,234.50". */
export function parseNumber(raw: string): number | null {
  let s = raw.replace(/[€$\s%]|eur/gi, "");
  if (!s) return null;
  const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lc >= 0) s = /,\d{3}$/.test(s) && s.indexOf(",") !== lc ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (ld >= 0 && s.indexOf(".") !== ld) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export const toMinor = (raw: string): number | null => { const n = parseNumber(raw); return n === null || n < 0 ? null : Math.round(n * 100); };
const pad = (n: number) => String(n).padStart(2, "0");
const validYmd = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
/** Date to YYYY-MM-DD: ISO, d/m/y (Greek order), d.m.y, d-m-y, 2-digit years, Excel serial numbers. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) { const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]; return validYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null; }
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})(?:\s.*)?$/.exec(s);
  if (m) {
    let [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    return validYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 20000 && serial < 80000) { const t = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; }
  }
  return null;
}
export function parseBool(raw: string): boolean | null {
  const s = norm(raw);
  if (["yes", "y", "true", "1", "ναι", "ν", "x", "✓", "active", "ενεργο"].includes(s)) return true;
  if (["no", "n", "false", "0", "οχι", "ο", "inactive", "ανενεργο"].includes(s)) return false;
  return null;
}
const UNITS: Record<string, string> = { kg: "kg", kgs: "kg", kilo: "kg", kila: "kg", κιλο: "kg", κιλα: "kg", piece: "piece", pieces: "piece", pc: "piece", pcs: "piece", τεμ: "piece", τεμαχιο: "piece", τεμαχια: "piece", box: "box", boxes: "box", κιβωτιο: "box", κουτι: "box", litre: "litre", liter: "litre", l: "litre", lt: "litre", λιτρο: "litre", λιτρα: "litre", pack: "pack", packs: "pack", πακετο: "pack", συσκευασια: "pack" };
export const cleanUnit = (raw: string): string | null => UNITS[norm(raw)] ?? null;
export function cleanAccountType(raw: string): "customer" | "prospect" | "lost" | null {
  const s = norm(raw);
  if (!s) return null;
  if (/prospect|lead|υποψηφ|δυνητ/.test(s)) return "prospect";
  if (/lost|inactive|closed|χαμεν|ανενεργ|κλειστ/.test(s)) return "lost";
  if (/customer|active|client|πελατ|ενεργ/.test(s)) return "customer";
  return null;
}
export const cleanChannel = (raw: string): string | null => { const s = norm(raw); return s.includes("whats") ? "whatsapp" : s.includes("viber") ? "viber" : /mail/.test(s) ? "email" : /phone|tel|τηλ|call/.test(s) ? "phone" : null; };
export const cleanVisitStatus = (raw: string): string | null => { const s = norm(raw); return !s ? null : /done|complet|visited|εγινε|ολοκλ/.test(s) ? "done" : /skip|cancel|ακυρ/.test(s) ? "skipped" : /plan|προγρ/.test(s) ? "planned" : null; };

// ===================================================================== mapping
export interface MappingGuess { source_column: string; target_field: string | null; confidence: number }

function valueSniff(values: string[]): { field: string; confidence: number } | null {
  const v = values.map((x) => x.trim()).filter(Boolean);
  if (v.length < 2) return null;
  const share = (f: (x: string) => boolean) => v.filter(f).length / v.length;
  if (share((x) => !!cleanEmail(x)) >= 0.8) return { field: "email", confidence: 0.8 };
  if (share((x) => /^(el|gr)?\s*\d{9}$/i.test(x.replace(/[\s.]/g, ""))) >= 0.8) return { field: "vat_number", confidence: 0.7 };
  if (share((x) => !!cleanPhone(x) && /[\d\s+()-]{10,}/.test(x)) >= 0.8) return { field: "phone", confidence: 0.65 };
  if (share((x) => /^\d{3}\s?\d{2}$/.test(x)) >= 0.8) return { field: "postal_code", confidence: 0.65 };
  if (share((x) => /^(https?:\/\/|www\.)/i.test(x)) >= 0.8) return { field: "website", confidence: 0.75 };
  return null;
}

/** Deterministic mapping: header synonyms (exact 0.95, contained 0.75), then value sniffing. */
export function heuristicMapping(dataType: DataType, sheet: Sheet): MappingGuess[] {
  const defs = TARGET_FIELDS[dataType];
  const names = new Set(defs.map((d) => d.field));
  return sheet.headers.map((h, i) => {
    const n = normSyn(h);
    let best: { field: string; confidence: number } | null = null;
    for (const d of defs) {
      for (const syn of [d.field.replace(/_/g, " "), ...d.synonyms].map(normSyn)) {
        const c = n === syn ? 0.95 : syn.length >= 3 && (` ${n} `.includes(` ${syn} `)) ? 0.75 : 0;
        if (c > (best?.confidence ?? 0)) best = { field: d.field, confidence: c };
      }
    }
    if (!best || best.confidence < 0.9) {
      const s = valueSniff(sheet.rows.slice(0, 50).map((r) => r[i] ?? ""));
      if (s && names.has(s.field) && s.confidence > (best?.confidence ?? 0)) best = s;
    }
    return { source_column: h, target_field: best?.field ?? null, confidence: best?.confidence ?? 0 };
  });
}

/** Heuristic + model: strong header matches win; otherwise the model's answer; one target per field (the weaker one asks). */
export function mergeMappings(dataType: DataType, heur: MappingGuess[], llm: MappingGuess[] | null): MappingGuess[] {
  const names = new Set(fieldNames(dataType));
  const byCol = new Map((llm ?? []).map((m) => [m.source_column, m]));
  const out = heur.map((h) => {
    const m = byCol.get(h.source_column);
    const mt = m && m.target_field && names.has(m.target_field) ? m.target_field : null;
    const mc = m ? Math.min(1, Math.max(0, Number(m.confidence) || 0)) : 0;
    if (h.confidence >= 0.9) return { ...h, confidence: mt === h.target_field ? Math.max(h.confidence, mc) : h.confidence };
    if (m && llm) {
      if (mt && mt === h.target_field) return { source_column: h.source_column, target_field: mt, confidence: Math.max(0.85, mc, h.confidence) };
      if (mt) return { source_column: h.source_column, target_field: mt, confidence: h.target_field ? Math.min(mc, 0.55) : mc };
      return { source_column: h.source_column, target_field: null, confidence: Math.max(mc, 0.6) };
    }
    return h;
  });
  // one source column per target field: the strongest keeps it, the others drop to confirmation
  const best = new Map<string, number>();
  out.forEach((m, i) => { if (m.target_field) { const j = best.get(m.target_field); if (j === undefined || out[j]!.confidence < m.confidence) best.set(m.target_field, i); } });
  return out.map((m, i) => (m.target_field && best.get(m.target_field) !== i ? { ...m, confidence: Math.min(m.confidence, 0.5) } : m))
    .map((m) => ({ ...m, confidence: Math.round(m.confidence * 100) / 100 }));
}

export interface MapDeps { model?: ModelFactory | null; useModel?: boolean }
/** Column mapping for a sheet: heuristic first, the import_mapping model for everything not certain. */
export async function mapColumns(dataType: DataType, sheet: Sheet, deps: MapDeps = {}): Promise<{ mapping: MappingGuess[]; model: string | null }> {
  const heur = heuristicMapping(dataType, sheet);
  if (deps.useModel === false || heur.every((h) => h.confidence >= 0.9)) return { mapping: mergeMappings(dataType, heur, null), model: null };
  const r = await callStructured("import_mapping", {
    data_type: dataType,
    headers: sheet.headers,
    sample_rows: sheet.rows.slice(0, SAMPLE_ROWS).map((row) => row.map((c) => String(c).slice(0, 80))),
    target_fields: TARGET_FIELDS[dataType].map((f) => ({ field: f.field, description: `${f.description}${f.required ? " (required)" : ""}` })),
  }, { model: deps.model ?? undefined, temperature: 0, instructions: "Map each header to at most one target field. Use target_field null for columns that match no field. Every header must appear exactly once in mappings." });
  for (const l of r.logs) log(l);
  if (!r.ok) { log(`mapping model unavailable (${r.error.code}: ${r.error.message}); heuristic mapping only`); return { mapping: mergeMappings(dataType, heur, null), model: null }; }
  return { mapping: mergeMappings(dataType, heur, r.value.mappings.map((m) => ({ source_column: m.source_column, target_field: m.target_field ?? null, confidence: m.confidence }))), model: r.profile };
}

// ===================================================================== evaluation (shared by analyze, get, apply)
export interface RowIssue { row_no: number; issue_type: IssueType; detail: string }
export interface EvaluatedRow { row_no: number; values: Record<string, unknown>; issues: RowIssue[]; skip: boolean }
export interface Lookups {
  postal: Map<string, { city: string }>;
  territoryByPostal: Map<string, string>;
  accountCategory: Map<string, string>;
  productCategory: Map<string, string>;
  accountsByVat: Map<string, Row<"account">>;
  accountsByRef: Map<string, Row<"account">>;
  accountsByName: Map<string, Row<"account">[]>;
  productsBySku: Map<string, Row<"product">>;
  users: Map<string, Row<"app_user">>;
  contactsByAccount: Map<string, Set<string>>;
  importedOrderRefs: Set<string>;
  visitKeys: Set<string>;
}

const nameKey = (s: unknown) => norm(s).replace(/\b(cafe|καφε|bakery|φουρνοσ|ο\.?ε|ε\.?ε|ike|ικε|ae|αε)\b/g, "").replace(/\s+/g, " ").trim();

export async function loadLookups(db: Db, dataType: DataType): Promise<Lookups> {
  const [postal, tpc, acats, pcats, accounts, products, users] = await Promise.all([
    db.postal_area.all(), db.territory_postal_code.all(), db.account_category.all(), db.product_category.all(),
    db.account.all({}, { cap: 20000 }), dataType === "products" || dataType === "orders" ? db.product.all() : Promise.resolve([] as Row<"product">[]), db.app_user.all(),
  ]);
  const L: Lookups = {
    postal: new Map(postal.map((p) => [p.postal_code, { city: p.city }])),
    territoryByPostal: new Map(tpc.map((t) => [t.postal_code, t.territory_id])),
    accountCategory: new Map(acats.map((c) => [norm(c.name), c.id])),
    productCategory: new Map(pcats.map((c) => [norm(c.name), c.id])),
    accountsByVat: new Map(), accountsByRef: new Map(), accountsByName: new Map(),
    productsBySku: new Map(products.map((p) => [p.sku.toLowerCase(), p])),
    users: new Map(), contactsByAccount: new Map(), importedOrderRefs: new Set(), visitKeys: new Set(),
  };
  for (const a of accounts) addAccount(L, a);
  for (const u of users) { if (u.email) L.users.set(u.email.toLowerCase(), u); L.users.set(norm(u.full_name), u); }
  if (dataType === "contacts") for (const c of await db.contact.all({}, { cap: 20000 })) addContact(L, c.account_id, c.full_name);
  if (dataType === "orders") for (const o of await db.sales_order.all({ source: "import" }, { cap: 20000 })) if (o.external_ref) L.importedOrderRefs.add(`${o.account_id}|${o.external_ref.replace(/^import:[^:]+:/, "")}`);
  if (dataType === "visits") for (const v of await db.visit.all({}, { cap: 20000 })) L.visitKeys.add(`${v.account_id}|${v.planned_date}`);
  return L;
}
export function addAccount(L: Lookups, a: Row<"account">) {
  if (a.vat_number) L.accountsByVat.set(a.vat_number, a);
  if (a.external_ref) L.accountsByRef.set(a.external_ref.toLowerCase(), a);
  const k = nameKey(a.name);
  if (k) L.accountsByName.set(k, [...(L.accountsByName.get(k) ?? []), a]);
}
const addContact = (L: Lookups, accountId: string, name: string) => { const s = L.contactsByAccount.get(accountId) ?? new Set<string>(); s.add(norm(name)); L.contactsByAccount.set(accountId, s); };

/** Account reference: VAT, ERP code, then exact name (ambiguous names are unknown). */
export function resolveAccount(L: Lookups, raw: string): Row<"account"> | null {
  const s = raw.trim();
  if (!s) return null;
  const vat = cleanVat(s);
  if (vat && L.accountsByVat.has(vat)) return L.accountsByVat.get(vat)!;
  if (L.accountsByRef.has(s.toLowerCase())) return L.accountsByRef.get(s.toLowerCase())!;
  const hits = L.accountsByName.get(nameKey(s)) ?? [];
  return hits.length === 1 ? hits[0]! : null;
}
const resolveUser = (L: Lookups, raw: string): Row<"app_user"> | null => (raw.trim() ? L.users.get(raw.trim().toLowerCase()) ?? L.users.get(norm(raw)) ?? null : null);

/** Mapping as {target_field -> column index}. */
export function columnIndex(headers: string[], mapping: Array<{ source_column: string; target_field?: string | null }>): Map<string, number> {
  const idx = new Map<string, number>();
  for (const m of mapping) {
    if (!m.target_field) continue;
    const i = headers.indexOf(m.source_column);
    if (i >= 0 && !idx.has(m.target_field)) idx.set(m.target_field, i);
  }
  return idx;
}

/**
 * Clean and check every row with the mapping. Pure except for the lookups. Also marks duplicates within the file
 * (the later row is the duplicate). `values` holds the cleaned record that fn:import-apply writes.
 */
export function evaluateRows(dataType: DataType, sheet: Sheet, mapping: Array<{ source_column: string; target_field?: string | null }>, L: Lookups): EvaluatedRow[] {
  const col = columnIndex(sheet.headers, mapping);
  const seen = new Map<string, number>();
  const out: EvaluatedRow[] = [];
  const firstSeen = (key: string, rowNo: number): number | null => { const f = seen.get(key); if (f !== undefined) return f; seen.set(key, rowNo); return null; };
  sheet.rows.forEach((r, i) => {
    const row_no = rowNoOf(sheet, i);
    const get = (f: string) => (col.has(f) ? String(r[col.get(f)!] ?? "").trim() : "");
    const issues: RowIssue[] = [];
    const add = (issue_type: IssueType, detail: string) => issues.push({ row_no, issue_type, detail });
    const v: Record<string, unknown> = {};
    for (const d of TARGET_FIELDS[dataType]) if (d.required && !get(d.field)) add("missing_required", `${d.field.replace(/_/g, " ")} is empty`);
    const phone = (f = "phone") => { const raw = get(f); if (!raw) return null; const p = cleanPhone(raw); if (!p) add("invalid_phone", `phone "${raw}" is not a valid phone number`); return p; };
    const email = () => { const raw = get("email"); if (!raw) return null; const e = cleanEmail(raw); if (!e) add("invalid_address", `email "${raw}" is not a valid email address`); return e; };
    const account = () => {
      const raw = get("account");
      if (!raw) return null;
      const a = resolveAccount(L, raw);
      if (!a) add("unknown_reference", `account "${raw}" is not a known customer (name, VAT or ERP code)`);
      return a;
    };
    const rep = (fallback: string | null) => {
      const raw = get("rep");
      const u = raw ? resolveUser(L, raw) : null;
      if (raw && !u) add("unknown_reference", `rep "${raw}" is not a Merc user`);
      return u?.id ?? fallback;
    };
    if (dataType === "accounts") {
      v.name = get("name").replace(/\s+/g, " ") || null;
      const vatRaw = get("vat_number");
      v.vat_number = vatRaw ? cleanVat(vatRaw) : null;
      if (vatRaw && !v.vat_number) add("invalid_vat", `VAT "${vatRaw}" is not 9 digits`);
      const addr = splitAddress(get("street"));
      v.street = addr.street;
      const pcRaw = get("postal_code") || addr.postal || "";
      const pc = pcRaw ? cleanPostal(pcRaw) : null;
      if (pcRaw && !pc) add("invalid_address", `postal code "${pcRaw}" is not 5 digits`);
      else if (pc && !L.postal.has(pc)) add("invalid_address", `postal code ${pc} is not a known postal area`);
      else if (!pcRaw && get("street")) add("invalid_address", "address has no postal code");
      v.postal_code = pc && L.postal.has(pc) ? pc : null;
      v.territory_id = v.postal_code ? L.territoryByPostal.get(v.postal_code as string) ?? null : null;
      v.phone = phone();
      v.email = email();
      v.website = get("website") ? cleanWebsite(get("website")) : null;
      const cat = get("category");
      v.category_id = cat ? L.accountCategory.get(norm(cat)) ?? [...L.accountCategory].find(([k]) => k.length >= 3 && (norm(cat).includes(k) || k.includes(norm(cat))))?.[1] ?? null : null;
      v.account_type = cleanAccountType(get("account_type")) ?? "customer";
      v.external_ref = get("external_ref") || null;
      v.customer_since = get("customer_since") ? parseDate(get("customer_since")) : null;
      const freq = get("visit_frequency_days") ? parseNumber(get("visit_frequency_days")) : null;
      v.visit_frequency_days = freq && freq > 0 ? Math.round(freq) : null;
      v.owner_rep_id = rep(null);
      if (v.vat_number) {
        const ex = L.accountsByVat.get(v.vat_number as string);
        if (ex) add("duplicate", `VAT ${v.vat_number} already belongs to ${ex.name}`);
        else { const f = firstSeen(`vat:${v.vat_number}`, row_no); if (f) add("duplicate", `same VAT as row ${f}`); }
      }
      if (!issues.some((x) => x.issue_type === "duplicate") && v.external_ref && L.accountsByRef.has(String(v.external_ref).toLowerCase())) add("duplicate", `code ${v.external_ref} already belongs to ${L.accountsByRef.get(String(v.external_ref).toLowerCase())!.name}`);
      if (!issues.some((x) => x.issue_type === "duplicate") && v.name) {
        const k = nameKey(v.name);
        const ex = (L.accountsByName.get(k) ?? []).find((a) => !v.postal_code || !a.postal_code || a.postal_code === v.postal_code);
        if (ex && !v.vat_number) add("duplicate", `${ex.name} already exists${ex.postal_code ? ` (${ex.postal_code})` : ""}`);
        else { const f = firstSeen(`name:${k}|${v.postal_code ?? ""}`, row_no); if (f) add("duplicate", `same name and postal code as row ${f}`); }
      }
    } else if (dataType === "contacts") {
      const a = account();
      v.account_id = a?.id ?? null;
      v.account_name = a?.name ?? null;
      v.full_name = get("full_name").replace(/\s+/g, " ") || null;
      v.role_title = get("role_title") || null;
      v.phone = phone();
      v.email = email();
      v.is_decision_maker = parseBool(get("is_decision_maker")) ?? false;
      v.preferred_channel = get("preferred_channel") ? cleanChannel(get("preferred_channel")) : null;
      if (a && v.full_name) {
        if (L.contactsByAccount.get(a.id)?.has(norm(v.full_name))) add("duplicate", `${v.full_name} is already a contact of ${a.name}`);
        else { const f = firstSeen(`${a.id}|${norm(v.full_name)}`, row_no); if (f) add("duplicate", `same contact as row ${f}`); }
      }
    } else if (dataType === "products") {
      v.sku = get("sku") || null;
      v.name = get("name") || null;
      const unitRaw = get("unit");
      v.unit = unitRaw ? cleanUnit(unitRaw) : "piece";
      if (unitRaw && !v.unit) { add("unknown_reference", `unit "${unitRaw}" is not kg, piece, box, litre or pack`); }
      const priceRaw = get("list_price");
      v.list_price_minor = priceRaw ? toMinor(priceRaw) : null;
      if (priceRaw && v.list_price_minor === null) add("missing_required", `price "${priceRaw}" is not a number`);
      const cat = get("category");
      v.category_id = cat ? L.productCategory.get(norm(cat)) ?? null : null;
      v.active = get("active") ? parseBool(get("active")) ?? true : true;
      if (v.sku) {
        const ex = L.productsBySku.get(String(v.sku).toLowerCase());
        if (ex) add("duplicate", `SKU ${v.sku} already exists (${ex.name})`);
        else { const f = firstSeen(`sku:${String(v.sku).toLowerCase()}`, row_no); if (f) add("duplicate", `same SKU as row ${f}`); }
      }
    } else if (dataType === "orders") {
      const a = account();
      v.account_id = a?.id ?? null;
      v.account_name = a?.name ?? null;
      v.order_ref = get("order_ref") || null;
      const dRaw = get("order_date");
      v.order_date = dRaw ? parseDate(dRaw) : null;
      if (dRaw && !v.order_date) add("missing_required", `order date "${dRaw}" is not a date`);
      const skuRaw = get("sku");
      const p = skuRaw ? L.productsBySku.get(skuRaw.toLowerCase()) ?? null : null;
      if (skuRaw && !p) add("unknown_reference", `product ${skuRaw} is not in the catalogue`);
      v.product_id = p?.id ?? null;
      v.sku = p?.sku ?? (skuRaw || null);
      const qRaw = get("quantity");
      const q = qRaw ? parseNumber(qRaw) : null;
      if (qRaw && (q === null || q <= 0)) add("missing_required", `quantity "${qRaw}" is not a positive number`);
      v.quantity = q && q > 0 ? q : null;
      const upRaw = get("unit_price");
      v.unit_price_minor = upRaw ? toMinor(upRaw) : p?.list_price_minor ?? null;
      const discRaw = get("discount_pct");
      const disc = discRaw ? parseNumber(discRaw) : null;
      v.discount_pct = disc !== null && disc >= 0 && disc <= 100 ? (disc > 0 && disc < 1 && discRaw.indexOf("%") < 0 ? Math.round(disc * 10000) / 100 : disc) : null;
      v.rep_id = rep(a?.owner_rep_id ?? null);
      if (a && v.order_ref && L.importedOrderRefs.has(`${a.id}|${v.order_ref}`)) add("duplicate", `order ${v.order_ref} of ${a.name} was already imported`);
    } else {
      const a = account();
      v.account_id = a?.id ?? null;
      v.account_name = a?.name ?? null;
      const dRaw = get("planned_date");
      v.planned_date = dRaw ? parseDate(dRaw) : null;
      if (dRaw && !v.planned_date) add("missing_required", `visit date "${dRaw}" is not a date`);
      v.status = cleanVisitStatus(get("status")) ?? "done";
      v.purpose = get("purpose") || null;
      v.outcome = get("outcome") || null;
      v.rep_id = rep(a?.owner_rep_id ?? null);
      if (a && v.planned_date) {
        if (L.visitKeys.has(`${a.id}|${v.planned_date}`)) add("duplicate", `${a.name} already has a visit on ${v.planned_date}`);
        else { const f = firstSeen(`${a.id}|${v.planned_date}`, row_no); if (f) add("duplicate", `same visit as row ${f}`); }
      }
    }
    out.push({ row_no, values: v, issues, skip: issues.some((x) => BLOCKING.has(x.issue_type)) });
  });
  return out;
}

export const flatIssues = (rows: EvaluatedRow[]): RowIssue[] => rows.flatMap((r) => r.issues);
export const rowsWithIssues = (rows: EvaluatedRow[]): number => rows.filter((r) => r.issues.length).length;

// ===================================================================== persistence helpers
/** Bounded-concurrency map (keeps 200-row imports well inside the function timeout). */
export async function pool<T, R>(items: T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await f(items[i]!, i); } }));
  return out;
}

/** Replace the import's issue rows with the given ones. */
export async function writeIssues(db: Db, importId: string, issues: RowIssue[]): Promise<void> {
  const old = await db.import_row_issue.all({ import_id: importId });
  await pool(old, 8, (r) => db.import_row_issue.delete(r.id));
  await pool(issues, 8, (x) => db.import_row_issue.insert({ import_id: importId, row_no: x.row_no, issue_type: x.issue_type, detail: x.detail.slice(0, 500) } as any));
}

export async function writeMapping(db: Db, importId: string, mapping: MappingGuess[]): Promise<Row<"import_column_mapping">[]> {
  const old = await db.import_column_mapping.all({ import_id: importId });
  await pool(old, 8, (r) => db.import_column_mapping.delete(r.id));
  return pool(mapping, 8, (m) => db.import_column_mapping.insert({ import_id: importId, source_column: m.source_column, target_field: m.target_field, confidence: m.confidence, confirmed: m.confidence >= CONFIRM_BELOW } as any));
}

export const isDataType = (s: string): s is DataType => s in TARGET_FIELDS;
export function dataTypeOf(imp: Row<"data_import">): DataType {
  if (!isDataType(imp.data_type)) throw invalid(`unknown data_type ${imp.data_type}`);
  return imp.data_type;
}
export async function orgOfImport(api: TablesApi, importId: string): Promise<string> {
  const imp = await createDb(api).data_import.get(importId);
  if (!imp) throw notFound("data_import not found", { id: importId });
  return imp.org_id;
}

// ===================================================================== fn:import-analyze
export interface AnalyzeDeps { storage: StorageLike | null; model?: ModelFactory | null; useModel?: boolean }
const REANALYZABLE = new Set(["uploaded", "mapping", "preview", "failed"]);

/** Parse, map, clean and report. Leaves the import in status "preview" (or "failed" with the reason logged). */
export async function analyzeImport(db: Db, imp: Row<"data_import">, deps: AnalyzeDeps): Promise<{ status: string; rows_total: number; issues: number }> {
  if (!REANALYZABLE.has(imp.status)) {
    const n = await db.import_row_issue.count({ import_id: imp.id });
    return { status: imp.status, rows_total: imp.rows_total ?? 0, issues: n };
  }
  const dataType = dataTypeOf(imp);
  await db.data_import.update(imp.id, { status: "mapping" });
  try {
    const sheet = await parseFile(await readFile(deps.storage, imp, SLUG), filenameOf(imp.file_ref) ?? "");
    const { mapping, model } = await mapColumns(dataType, sheet, deps);
    await writeMapping(db, imp.id, mapping);
    const evaluated = evaluateRows(dataType, sheet, mapping, await loadLookups(db, dataType));
    const issues = flatIssues(evaluated);
    await writeIssues(db, imp.id, issues);
    await db.data_import.update(imp.id, { status: "preview", rows_total: sheet.rows.length, rows_with_issues: rowsWithIssues(evaluated) });
    log(`analyzed ${imp.id}: ${sheet.rows.length} rows, ${mapping.filter((m) => m.confidence < CONFIRM_BELOW).length} to confirm, ${issues.length} issues (model ${model ?? "none"})`);
    return { status: "preview", rows_total: sheet.rows.length, issues: issues.length };
  } catch (e) {
    log(`analyze ${imp.id} failed: ${isMercError(e) ? `${e.code} ${e.message}` : msg(e)}`);
    await db.data_import.update(imp.id, { status: "failed" }).catch(() => undefined);
    throw e;
  }
}

export function makeImpl(deps: AnalyzeDeps): Impl<"import-analyze", Principal> {
  return async ({ req, db }) => analyzeImport(db, await db.data_import.require(req.import_id), deps);
}

/** Wonderful Function entry (functions/import-analyze/index.ts). Caller: procedure import-pipeline (system principal of the import's org). */
export const handle = defineSystemFunction(SLUG, (c: FunctionContext) => makeImpl({ storage: storageOf(c) }), (api, req) => orgOfImport(api, req.import_id));
