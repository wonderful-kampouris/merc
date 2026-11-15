// fn:import-confirm (contracts/functions/import-confirm.json, REQ-IMP-001). Mgmt screen /mgmt/import (gate
// import.manage). The admin confirms the preview, optionally overriding column mappings:
//   mapping_overrides: [{source_column, target_field: "<field>" | null}]   (null = ignore the column)
// Every mapping row becomes confirmed, the import goes to "confirmed" (confirmed_at set). The import-pipeline
// procedure waits on exactly that status and runs fn:import-apply. Without a procedure run (inline mode, see
// fn:import-start) the apply runs here and the response status is "imported".
import { defineFunction, invalid, conflict, type FunctionContext, type Impl, type Principal } from "../../core/src/index";
import { dataTypeOf, fieldNames, storageOf, targetFields, pool, type StorageLike } from "./import-analyze";
import { applyImport } from "./import-apply";

export const SLUG = "import-confirm" as const;

export interface ConfirmDeps { storage: StorageLike | null }

export function makeImpl(deps: ConfirmDeps): Impl<"import-confirm", Principal> {
  return async ({ req, db, me }) => {
    const imp = await db.data_import.require(req.import_id);
    if (["confirmed", "importing", "imported"].includes(imp.status)) return { import_id: imp.id, status: imp.status };
    if (imp.status !== "preview") throw conflict(`import is ${imp.status}; it can be confirmed once the preview is ready`, { status: imp.status });
    const dataType = dataTypeOf(imp);
    const allowed = new Set(fieldNames(dataType));
    const rows = await db.import_column_mapping.all({ import_id: imp.id });
    const bySource = new Map(rows.map((r) => [r.source_column, r]));
    const target = new Map(rows.map((r) => [r.source_column, r.target_field ?? null]));
    for (const [i, o] of req.mapping_overrides.entries()) {
      const src = (o as { source_column?: unknown }).source_column;
      const tf = (o as { target_field?: unknown }).target_field ?? null;
      if (typeof src !== "string" || !bySource.has(src)) throw invalid(`mapping_overrides[${i}].source_column is not a column of this file`, { source_column: src ?? null });
      if (tf !== null && (typeof tf !== "string" || !allowed.has(tf))) throw invalid(`mapping_overrides[${i}].target_field must be one of ${[...allowed].join(", ")} or null`, { target_field: tf });
      target.set(src, tf as string | null);
    }
    const used = new Map<string, string>();
    for (const [src, tf] of target) {
      if (!tf) continue;
      if (used.has(tf)) throw invalid(`${tf} is mapped twice (${used.get(tf)} and ${src})`, { target_field: tf });
      used.set(tf, src);
    }
    const missing = targetFields(dataType).filter((f) => f.required && !used.has(f.field)).map((f) => f.field);
    if (missing.length) throw invalid(`required fields are not mapped: ${missing.join(", ")}`, { missing });
    await pool(rows, 8, (r) => db.import_column_mapping.update(r.id, { target_field: target.get(r.source_column) ?? null, confirmed: true }));
    const confirmed = await db.data_import.update(imp.id, { status: "confirmed", confirmed_at: new Date().toISOString() });
    if (confirmed.procedure_run_id) return { import_id: imp.id, status: "confirmed" };
    await applyImport(db, me, confirmed, { storage: deps.storage });
    return { import_id: imp.id, status: "imported" };
  };
}

export const depsOf = (c: unknown): ConfirmDeps => ({ storage: storageOf(c) });

/** Wonderful Function entry (functions/import-confirm/index.ts). */
export const handle = (context: FunctionContext) => defineFunction(SLUG, makeImpl(depsOf(context)) as Impl<typeof SLUG>)(context);
