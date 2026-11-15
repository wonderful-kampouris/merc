// fn:import-get (contracts/functions/import-get.json, REQ-IMP-001 / REQ-IMP-002). Mgmt screen /mgmt/import (gate
// import.manage). The import with its column mapping (confidence, which ones need confirmation, the allowed target
// fields), the row issues (each bad row with the reason) and a preview of the first rows as they would be imported,
// computed live from the stored file and the current mapping.
import { defineFunction, isMercError, type FunctionContext, type Impl, type Principal } from "../../core/src/index";
import {
  CONFIRM_BELOW, PREVIEW_ROWS, dataTypeOf, evaluateRows, filenameOf, loadLookups, parseFile, readFile, storageOf, targetFields, type StorageLike,
} from "./import-analyze";

export const SLUG = "import-get" as const;
const iso = (v: unknown) => (typeof v === "number" ? new Date(v).toISOString() : v ?? null);

export interface GetDeps { storage: StorageLike | null }

export function makeImpl(deps: GetDeps): Impl<"import-get", Principal> {
  return async ({ req, db }) => {
    const imp = await db.data_import.require(req.import_id);
    const dataType = dataTypeOf(imp);
    const [mapRows, issueRows] = await Promise.all([
      db.import_column_mapping.all({ import_id: imp.id }),
      db.import_row_issue.all({ import_id: imp.id }, { orderBy: [{ column: "row_no", direction: "asc" }] }),
    ]);
    let headers: string[] = [];
    let preview: Record<string, unknown>[] = [];
    let preview_error: string | null = null;
    if (imp.file_ref && imp.status !== "uploaded") {
      try {
        const sheet = await parseFile(await readFile(deps.storage, imp, SLUG), filenameOf(imp.file_ref) ?? "");
        headers = sheet.headers;
        const limited = { ...sheet, rows: sheet.rows.slice(0, PREVIEW_ROWS) };
        (limited as any).rowNos = (sheet as any).rowNos?.slice(0, PREVIEW_ROWS);
        const rows = evaluateRows(dataType, limited, mapRows, await loadLookups(db, dataType));
        preview = rows.map((r) => ({ row_no: r.row_no, action: r.skip ? "skip" : "import", values: r.values, issues: r.issues.map((x) => ({ issue_type: x.issue_type, detail: x.detail })) }));
      } catch (e) { preview_error = isMercError(e) ? `${e.code}: ${e.message}` : String((e as Error)?.message ?? e); }
    }
    const order = (c: string) => { const i = headers.indexOf(c); return i < 0 ? 9999 : i; };
    const mapping = mapRows
      .sort((a, b) => order(a.source_column) - order(b.source_column) || a.source_column.localeCompare(b.source_column))
      .map((m) => ({ id: m.id, source_column: m.source_column, target_field: m.target_field ?? null, confidence: m.confidence ?? 0, confirmed: m.confirmed, needs_confirmation: !m.confirmed && (m.confidence ?? 0) < CONFIRM_BELOW }));
    const issues = issueRows.map((x) => ({ row_no: x.row_no, issue_type: x.issue_type, detail: x.detail ?? null }));
    return {
      import: {
        id: imp.id, data_type: imp.data_type, status: imp.status, filename: filenameOf(imp.file_ref), file_ref: imp.file_ref ?? null,
        is_baseline: imp.is_baseline, rows_total: imp.rows_total ?? null, rows_imported: imp.rows_imported ?? null, rows_with_issues: imp.rows_with_issues ?? null,
        confirmed_at: imp.confirmed_at ?? null, created_at: iso(imp.created_at), uploaded_by: imp.uploaded_by, procedure_run_id: imp.procedure_run_id ?? null,
        confirmations_needed: mapping.filter((m) => m.needs_confirmation).length,
        confirm_below: CONFIRM_BELOW,
        target_fields: targetFields(dataType).map((f) => ({ field: f.field, description: f.description, required: !!f.required })),
        preview_error,
      },
      mapping, issues, preview_rows: preview,
    };
  };
}

export const depsOf = (c: unknown): GetDeps => ({ storage: storageOf(c) });

/** Wonderful Function entry (functions/import-get/index.ts). */
export const handle = (context: FunctionContext) => defineFunction(SLUG, makeImpl(depsOf(context)) as Impl<typeof SLUG>)(context);
