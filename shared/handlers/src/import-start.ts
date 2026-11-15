// fn:import-start (contracts/functions/import-start.json, REQ-IMP-001 / REQ-IMP-003). Mgmt screen /mgmt/import, admin
// only (gate import.manage). Creates the data_import (is_baseline flag kept for the before/after metrics), keeps the
// file in Custom Storage, checks it parses, then starts the import pipeline:
//   1. procedure import-pipeline through context.automations.invoke when global variable MERC_IMPORT_PROCEDURE_ID names
//      the published procedure (analyze -> wait for status confirmed -> apply). Returns status "mapping";
//   2. otherwise (not deployed yet, or invoke fails) fn:import-analyze runs inline and the import is in "preview" when
//      this call returns. fn:import-confirm then applies inline as well.
// The file: csv_base64 (CSV/TSV text or .xlsx bytes, base64) or file_ref (a Custom Storage key the app uploaded).
import { blocked, defineFunction, globalString, invalid, type FunctionContext, type Impl, type PlatformLike, type Principal, type Row, type Db } from "../../core/src/index";
import { analyzeImport, decodeBase64, isZip, parseFile, safeFilename, storageKey, storageOf, blockedStorage, type AnalyzeDeps, type StorageLike } from "./import-analyze";
import type { ModelFactory } from "../../llm/src/index";

export const SLUG = "import-start" as const;
export const GLOBAL_PIPELINE_ID = "MERC_IMPORT_PROCEDURE_ID";
const log = (m: string) => console.log(`[import-start] ${m}`);

export interface AutomationsLike { invoke(o: { automationId: string; input: unknown }): Promise<{ runId?: string; status?: string } | null | undefined> }
export interface StartDeps { storage: StorageLike | null; automations?: AutomationsLike | null; model?: ModelFactory | null; useModel?: boolean }

const contentType = (name: string, bytes: Uint8Array) =>
  isZip(bytes) || /\.xlsx$/i.test(name) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : /\.tsv$/i.test(name) ? "text/tab-separated-values" : "text/csv";

/** Start the pipeline for an uploaded import: the procedure when configured, else analyze inline. */
export async function startPipeline(db: Db, imp: Row<"data_import">, platform: PlatformLike, deps: StartDeps): Promise<string> {
  const procedureId = globalString(platform, GLOBAL_PIPELINE_ID);
  if (procedureId && deps.automations && typeof deps.automations.invoke === "function") {
    try {
      const r = await deps.automations.invoke({ automationId: procedureId, input: { import_id: imp.id } });
      await db.data_import.update(imp.id, { status: "mapping", ...(r?.runId ? { procedure_run_id: String(r.runId) } : { procedure_run_id: "started" }) });
      return "mapping";
    } catch (e) {
      log(`procedure ${procedureId} could not start (${(e as Error)?.message ?? e}); analyzing inline`);
    }
  }
  const analyzeDeps: AnalyzeDeps = { storage: deps.storage, model: deps.model, useModel: deps.useModel };
  return (await analyzeImport(db, imp, analyzeDeps)).status;
}

export function makeImpl(deps: StartDeps): Impl<"import-start", Principal> {
  return async ({ req, db, me, platform }) => {
    if (me.kind !== "user") throw invalid("imports are started by an admin");
    const filename = safeFilename(req.filename);
    const b64 = req.csv_base64 ?? null, ref = req.file_ref?.trim() || null;
    if (!b64 && !ref) throw invalid("send the file as csv_base64 or a Custom Storage file_ref");
    if (!deps.storage) throw blockedStorage(SLUG);
    let bytes: Uint8Array | null = null;
    if (b64) {
      bytes = decodeBase64(b64);
      if (!bytes || !bytes.length) throw invalid("csv_base64 is not valid base64");
    } else {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.\-]{0,511}$/.test(ref!) || ref!.includes("..")) throw invalid("file_ref is not a valid storage key");
      if (ref!.startsWith("merc/voice-logs/")) throw invalid("file_ref must be a spreadsheet upload");
      try { bytes = (await deps.storage.download(ref!)).data; } catch (e) { throw invalid(`file_ref ${ref} could not be read: ${(e as Error)?.message ?? e}`); }
    }
    await parseFile(bytes!, filename); // fail fast on an unreadable file, before any row exists
    let imp = await db.data_import.insert({ uploaded_by: me.id, data_type: req.data_type, status: "uploaded", is_baseline: req.is_baseline === true, file_ref: ref } as any);
    if (b64) {
      const key = storageKey(imp.id, filename);
      try { await deps.storage.upload(key, bytes!, contentType(filename, bytes!)); }
      catch (e) { await db.data_import.update(imp.id, { status: "failed" }); throw blocked(`import file could not be stored: ${(e as Error)?.message ?? e}`, { key }); }
      imp = await db.data_import.update(imp.id, { file_ref: key });
    }
    const status = await startPipeline(db, imp, platform, deps);
    return { import_id: imp.id, status };
  };
}

/** Deps from the runtime context: context.storage (file), context.automations (procedure). */
export const depsOf = (c: unknown): StartDeps => ({ storage: storageOf(c), automations: ((c as { automations?: AutomationsLike }).automations ?? null) });

/** Wonderful Function entry (functions/import-start/index.ts). */
export const handle = (context: FunctionContext) => defineFunction(SLUG, makeImpl(depsOf(context)) as Impl<typeof SLUG>)(context);
