import type { FunctionRequestMap, FunctionResponseMap } from "../../../contracts";
import { bool, isObj, num, objArr, str, type Obj } from "../settings/kit";

export type DataType = FunctionRequestMap["import-start"]["data_type"];
export const DATA_TYPES: readonly DataType[] = ["accounts", "contacts", "orders", "products", "visits"];

/** REQ-IMP-001: a mapping below this confidence needs a human confirmation before apply. */
export const CONFIRM_BELOW = 0.6;

/** Target fields per data type: the importable columns of the target table (contracts/tables). */
export const TARGET_FIELDS: Record<DataType, readonly string[]> = {
  accounts: ["name", "account_type", "category", "vat_number", "street", "postal_code", "phone", "email", "website", "territory", "owner_rep", "customer_since", "visit_frequency_days", "external_ref"],
  contacts: ["account", "full_name", "role_title", "phone", "email", "is_decision_maker", "preferred_channel"],
  orders: ["account", "rep", "status", "order_date", "product", "quantity", "unit_price", "external_ref"],
  products: ["sku", "name", "category", "unit", "list_price", "active"],
  visits: ["account", "rep", "planned_date", "status", "purpose", "outcome", "completed_at"],
};

export interface Mapping {
  source_column: string;
  target_field: string | null;
  confidence: number;
  confirmed: boolean;
}
export interface Issue {
  row_no: number;
  issue_type: string;
  detail: string;
}
export interface ImportView {
  status: string;
  rows_total: number | null;
  rows_imported: number | null;
  rows_with_issues: number | null;
  mapping: Mapping[];
  issues: Issue[];
  preview: Obj[];
}

export function parseImport(r: FunctionResponseMap["import-get"]): ImportView {
  const imp = isObj(r.import) ? r.import : {};
  return {
    status: str(imp, "status"),
    rows_total: num(imp, "rows_total"),
    rows_imported: num(imp, "rows_imported"),
    rows_with_issues: num(imp, "rows_with_issues"),
    mapping: objArr(r.mapping)
      .filter((o) => str(o, "source_column"))
      .map((o) => ({ source_column: str(o, "source_column"), target_field: str(o, "target_field") || null, confidence: num(o, "confidence") ?? 0, confirmed: bool(o, "confirmed") })),
    issues: objArr(r.issues)
      .filter((o) => num(o, "row_no") !== null && str(o, "issue_type"))
      .map((o) => ({ row_no: num(o, "row_no")!, issue_type: str(o, "issue_type"), detail: str(o, "detail") })),
    preview: objArr(r.preview_rows).filter((o) => Object.keys(o).length > 0),
  };
}

/** Statuses after which polling stops (data_import.status enum). */
export const READY = new Set(["preview", "confirmed", "importing", "imported", "failed"]);
export const DONE = new Set(["imported", "failed"]);
export const isReady = (v: ImportView): boolean => READY.has(v.status) || v.mapping.length > 0;

/** User edits per source column: a changed target, or a confirmation of the AI's guess. */
export type Edits = Record<string, { target_field: string | null; confirmed: boolean }>;

export const needsConfirm = (m: Mapping): boolean => m.confidence < CONFIRM_BELOW && !m.confirmed;
export function effective(m: Mapping, edits: Edits): Mapping {
  const e = edits[m.source_column];
  return e ? { ...m, target_field: e.target_field, confirmed: e.confirmed } : m;
}
export const pendingConfirmations = (ms: readonly Mapping[], edits: Edits): Mapping[] => ms.map((m) => effective(m, edits)).filter(needsConfirm);

/** Two source columns may not land on the same field. */
export function duplicateTargets(ms: readonly Mapping[], edits: Edits): string[] {
  const seen = new Map<string, number>();
  for (const m of ms.map((x) => effective(x, edits))) if (m.target_field) seen.set(m.target_field, (seen.get(m.target_field) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([f]) => f);
}

export const canApply = (ms: readonly Mapping[], edits: Edits): boolean =>
  ms.length > 0 && pendingConfirmations(ms, edits).length === 0 && duplicateTargets(ms, edits).length === 0;

export function toOverrides(importId: string, ms: readonly Mapping[], edits: Edits): FunctionRequestMap["import-confirm"] {
  return {
    import_id: importId,
    mapping_overrides: ms
      .filter((m) => edits[m.source_column])
      .map((m) => ({ source_column: m.source_column, target_field: edits[m.source_column]!.target_field, confirmed: true })),
  };
}

/* ---------- file handling ---------- */

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Minimal CSV reader for the local preview: detects `,` `;` or tab, handles quotes. */
export function parseCsv(text: string, maxRows = 50): { headers: string[]; rows: string[][] } {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [";", "\t", ","].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length && rows.length <= maxRows; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell.trim()); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some((x) => x)) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some((x) => x)) rows.push(row); }
  const [headers = [], ...body] = rows;
  return { headers, rows: body.slice(0, maxRows) };
}

const SYNONYMS: Record<string, string[]> = {
  name: ["name", "επωνυμια", "ονομα", "shop", "store", "κατάστημα", "επωνυμία"],
  full_name: ["full name", "contact", "ονοματεπωνυμο", "υπευθυνος"],
  vat_number: ["vat", "afm", "αφμ", "tax"],
  street: ["address", "street", "διευθυνση", "οδος"],
  postal_code: ["zip", "postal", "τκ", "τ.κ.", "postcode"],
  phone: ["phone", "tel", "τηλεφωνο", "κινητο", "mobile"],
  email: ["email", "e-mail", "mail"],
  category: ["category", "type", "κατηγορια", "είδος"],
  sku: ["sku", "code", "κωδικος"],
  order_date: ["date", "ημερομηνια"],
};
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[_\-.]+/g, " ").trim();

/**
 * Mock mode only: the contract mock of import-get returns empty objects, so the screen derives a demo mapping
 * from the file's own header row. Exact field names score 0.95, synonyms 0.7, anything else 0.3 (unmapped).
 */
export function demoMapping(headers: readonly string[], type: DataType): Mapping[] {
  const fields = TARGET_FIELDS[type];
  return headers.map((h) => {
    const f = fold(h);
    const exact = fields.find((x) => fold(x) === f);
    if (exact) return { source_column: h, target_field: exact, confidence: 0.95, confirmed: false };
    const syn = fields.find((x) => (SYNONYMS[x] ?? []).some((s) => f.includes(fold(s))));
    if (syn) return { source_column: h, target_field: syn, confidence: 0.7, confirmed: false };
    return { source_column: h, target_field: null, confidence: 0.3, confirmed: false };
  });
}

export const confidencePct = (c: number): string => `${Math.round(c * 100)}%`;
