// fn:import-apply (contracts/functions/import-apply.json, REQ-IMP-001..003). Last step of procedure import-pipeline,
// after the admin confirmed the mapping (data_import.status == "confirmed"); also run inline by fn:import-confirm when
// the procedure is not configured. Re-reads the file, re-checks every row with the CONFIRMED mapping (so issues match
// what really happened), writes the clean rows and the final issue list, then marks the import "imported".
//   - accounts -> account (source import, territory from the postal code), contacts -> contact,
//     products -> product, orders -> sales_order + order_line (one order per order_ref, status confirmed, source import),
//     visits -> visit (origin manual).
//   - REQ-IMP-003: imported orders keep their historical order_date and carry external_ref "import:<import_id>:<ref>",
//     so a baseline import (data_import.is_baseline) lands in the baseline_start..go_live_date "before" period.
// Rows with a blocking issue (duplicate, missing_required, unknown_reference) are skipped; other issues import the row
// with the bad value cleared. Idempotent: an import already "imported" returns its counts.
import { invalid, isMercError, type Db, type FunctionContext, type Impl, type Principal, type Row } from "../../core/src/index";
import { defineSystemFunction } from "./candidate-get";
import {
  addAccount, dataTypeOf, evaluateRows, filenameOf, flatIssues, loadLookups, orgOfImport, parseFile, pool, readFile, rowsWithIssues, storageOf, writeIssues,
  type EvaluatedRow, type StorageLike,
} from "./import-analyze";

export const SLUG = "import-apply" as const;
const log = (m: string) => console.log(`[import-apply] ${m}`);
const msg = (e: unknown) => (isMercError(e) ? `${e.code}: ${e.message}` : String((e as { message?: unknown })?.message ?? e)).slice(0, 300);
const APPLYABLE = new Set(["confirmed", "importing", "failed"]);

export interface ApplyDeps { storage: StorageLike | null }

const pick = <T extends Record<string, unknown>>(v: Record<string, unknown>, keys: (keyof T & string)[]) => Object.fromEntries(keys.map((k) => [k, v[k] ?? null]));

/** Write the clean rows. Returns how many source rows became records, and per-row write failures as issues. */
async function writeRows(db: Db, imp: Row<"data_import">, me: Principal, rows: EvaluatedRow[], L: Awaited<ReturnType<typeof loadLookups>>): Promise<{ imported: number; failed: EvaluatedRow[] }> {
  const ok = rows.filter((r) => !r.skip);
  const failed: EvaluatedRow[] = [];
  const fail = (r: EvaluatedRow, e: unknown) => { log(`row ${r.row_no}: ${msg(e)}`); failed.push({ ...r, skip: true, issues: [...r.issues, { row_no: r.row_no, issue_type: isMercError(e) && e.code === "conflict" ? "duplicate" : "missing_required", detail: `not imported: ${msg(e)}` }] }); };
  const dataType = dataTypeOf(imp);
  let imported = 0;
  if (dataType === "orders") {
    // one order per (account, order_ref) or, without a ref, per (account, date, rep)
    const groups = new Map<string, EvaluatedRow[]>();
    for (const r of ok) {
      const v = r.values;
      const key = v.order_ref ? `${v.account_id}|ref:${v.order_ref}` : `${v.account_id}|${v.order_date}|${v.rep_id}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    await pool([...groups.values()], 6, async (lines) => {
      const v = lines[0]!.values;
      const repId = (v.rep_id as string | null) ?? imp.uploaded_by;
      const ref = `import:${imp.id}:${(v.order_ref as string | null) ?? `row${lines[0]!.row_no}`}`;
      try {
        const order = await db.sales_order.insert({ account_id: v.account_id, rep_id: repId, status: "confirmed", source: "import", order_date: v.order_date, external_ref: ref } as any);
        let n = 0;
        for (const l of lines) {
          try {
            await db.order_line.insert({ order_id: order.id, line_no: ++n, product_id: l.values.product_id, quantity: l.values.quantity, unit_price_minor: l.values.unit_price_minor ?? 0, discount_pct: l.values.discount_pct ?? null } as any);
            imported++;
          } catch (e) { fail(l, e); }
        }
      } catch (e) { for (const l of lines) fail(l, e); }
    });
    return { imported, failed };
  }
  await pool(ok, 8, async (r) => {
    const v = r.values;
    try {
      if (dataType === "accounts") {
        const a = await db.account.insert({ ...pick(v, ["name", "vat_number", "street", "postal_code", "phone", "email", "website", "category_id", "account_type", "external_ref", "customer_since", "visit_frequency_days", "owner_rep_id", "territory_id"]), source: "import" } as any);
        addAccount(L, a);
      } else if (dataType === "contacts") {
        await db.contact.insert(pick(v, ["account_id", "full_name", "role_title", "phone", "email", "is_decision_maker", "preferred_channel"]) as any);
      } else if (dataType === "products") {
        await db.product.insert(pick(v, ["sku", "name", "unit", "list_price_minor", "category_id", "active"]) as any);
      } else {
        const done = v.status === "done";
        await db.visit.insert({ ...pick(v, ["account_id", "planned_date", "status", "purpose", "outcome"]), rep_id: (v.rep_id as string | null) ?? imp.uploaded_by, origin: "manual", completed_at: done ? `${v.planned_date}T12:00:00.000Z` : null } as any);
      }
      imported++;
    } catch (e) { fail(r, e); }
  });
  void me;
  return { imported, failed };
}

export async function applyImport(db: Db, me: Principal, imp: Row<"data_import">, deps: ApplyDeps): Promise<{ rows_imported: number; rows_with_issues: number }> {
  if (imp.status === "imported") return { rows_imported: imp.rows_imported ?? 0, rows_with_issues: imp.rows_with_issues ?? 0 };
  if (!APPLYABLE.has(imp.status)) throw invalid(`import is ${imp.status}; confirm the mapping first`, { status: imp.status });
  const dataType = dataTypeOf(imp);
  const mapping = (await db.import_column_mapping.all({ import_id: imp.id })).map((m) => ({ source_column: m.source_column, target_field: m.target_field ?? null }));
  await db.data_import.update(imp.id, { status: "importing" });
  try {
    const sheet = await parseFile(await readFile(deps.storage, imp, SLUG), filenameOf(imp.file_ref) ?? "");
    const L = await loadLookups(db, dataType);
    const rows = evaluateRows(dataType, sheet, mapping, L);
    const { imported, failed } = await writeRows(db, imp, me, rows, L);
    const byRow = new Map(rows.map((r) => [r.row_no, r]));
    for (const f of failed) byRow.set(f.row_no, f);
    const final = [...byRow.values()];
    await writeIssues(db, imp.id, flatIssues(final));
    const withIssues = rowsWithIssues(final);
    await db.data_import.update(imp.id, { status: "imported", rows_total: sheet.rows.length, rows_imported: imported, rows_with_issues: withIssues });
    log(`imported ${imp.id} (${dataType}${imp.is_baseline ? ", baseline" : ""}): ${imported}/${sheet.rows.length} rows, ${withIssues} with issues`);
    return { rows_imported: imported, rows_with_issues: withIssues };
  } catch (e) {
    log(`apply ${imp.id} failed: ${msg(e)}`);
    await db.data_import.update(imp.id, { status: "failed" }).catch(() => undefined);
    throw e;
  }
}

export function makeImpl(deps: ApplyDeps): Impl<"import-apply", Principal> {
  return async ({ req, db, me }) => applyImport(db, me, await db.data_import.require(req.import_id), deps);
}

/** Wonderful Function entry (functions/import-apply/index.ts). Caller: procedure import-pipeline (system principal of the import's org). */
export const handle = defineSystemFunction(SLUG, (c: FunctionContext) => makeImpl({ storage: storageOf(c) }), (api, req) => orgOfImport(api, req.import_id));
