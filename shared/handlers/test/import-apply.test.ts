import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, makeImpl } from "../src/import-apply";
import { analyzeImport, type StorageLike } from "../src/import-analyze";
import { baselineOrders, toCsv } from "../../../procedures/import-pipeline/fixtures/make-fixtures";

const enc = (s: string) => new TextEncoder().encode(s);
async function confirmedImport(t: ReturnType<typeof kit>, dataType: string, csv: string, opts: { is_baseline?: boolean } = {}) {
  let imp = await t.db.data_import.insert({ uploaded_by: IDS.thanasis, data_type: dataType, status: "uploaded", is_baseline: !!opts.is_baseline, file_ref: null } as any);
  const key = `merc/imports/${imp.id}/f.csv`;
  const files = new Map<string, Uint8Array>([[key, enc(csv)]]);
  const storage: StorageLike = { upload: async (k, d) => { files.set(k, d); return { key: k }; }, download: async (k) => ({ data: files.get(k)! }) };
  imp = await t.db.data_import.update(imp.id, { file_ref: key });
  await analyzeImport(t.db, imp, { storage, useModel: false });
  await t.db.data_import.update(imp.id, { status: "confirmed", confirmed_at: new Date().toISOString() });
  return { id: imp.id, storage };
}
const sysCtx = (t: ReturnType<typeof kit>, storage: StorageLike, body: unknown) => Object.assign(t.fnCtx(null, body), { storage }) as any;

describe("fn:import-apply (procedure step; REQ-IMP-002, REQ-IMP-003)", () => {
  it("a baseline orders import lands in the before period: historical dates kept, one order per invoice, source import", async () => {
    const t = kit();
    const { id, storage } = await confirmedImport(t, "orders", toCsv(baselineOrders(), ","), { is_baseline: true });
    const r = ok(await handle(sysCtx(t, storage, { import_id: id, caller: { user_id: IDS.nikos } })));
    expect(validateResponse("import-apply", r).ok).toBe(true);
    expect(r).toEqual({ rows_imported: 12, rows_with_issues: 0 });
    const orders = await t.db.sales_order.all({ external_ref: { op: "starts_with", value: `import:${id}:` } });
    expect(orders).toHaveLength(6);
    const org = await t.db.organization.require(IDS.org);
    for (const o of orders) {
      expect(o).toMatchObject({ source: "import", status: "confirmed" });
      expect(o.order_date >= org.baseline_start! && o.order_date < org.go_live_date!).toBe(true); // before period (metrics.md before-after)
    }
    const inv = orders.find((o) => o.external_ref === `import:${id}:INV-B100`)!;
    expect(inv).toMatchObject({ account_id: IDS.miltos, order_date: "2026-08-03" });
    const lines = await t.db.order_line.all({ order_id: inv.id }, { orderBy: [{ column: "line_no", direction: "asc" }] });
    expect(lines.map((l) => [l.line_no, l.quantity, l.unit_price_minor])).toEqual([[1, 5, 1890], [2, 8, 450]]);
    expect((await t.db.data_import.require(id))).toMatchObject({ status: "imported", is_baseline: true, rows_imported: 12 });
    // the same invoices again are duplicates
    const again = await confirmedImport(t, "orders", toCsv(baselineOrders(), ","));
    const r2 = ok(await handle(sysCtx(t, again.storage, { import_id: again.id })));
    expect(r2.rows_imported).toBe(0);
    expect(await t.db.import_row_issue.count({ import_id: again.id, issue_type: "duplicate" })).toBe(12);
  });
  it("contacts, products and visits import with references checked", async () => {
    const t = kit();
    const c = await confirmedImport(t, "contacts", "Πελάτης;Ονοματεπώνυμο;Θέση;Τηλέφωνο\nERP-1000;Anna Nea;Barista;6944111222\nERP-1000;Miltos Papadakis;Owner;\nNobody Shop;X Y;;\n");
    expect(ok(await handle(sysCtx(t, c.storage, { import_id: c.id })))).toEqual({ rows_imported: 1, rows_with_issues: 2 });
    expect(await t.db.contact.findOne({ full_name: "Anna Nea" })).toMatchObject({ account_id: IDS.miltos, phone: "+306944111222", is_decision_maker: false });
    const kinds = (await t.db.import_row_issue.all({ import_id: c.id })).map((x) => x.issue_type).sort();
    expect(kinds).toEqual(["duplicate", "unknown_reference"]);
    const p = await confirmedImport(t, "products", "SKU,Περιγραφή,Μονάδα,Τιμή\nNEW-1,Νέο προϊόν,κιλό,\"12,50\"\nESP-CL-1,dup,kg,1\n");
    expect(ok(await handle(sysCtx(t, p.storage, { import_id: p.id })))).toEqual({ rows_imported: 1, rows_with_issues: 1 });
    expect(await t.db.product.findOne({ sku: "NEW-1" })).toMatchObject({ unit: "kg", list_price_minor: 1250, active: true });
    const v = await confirmedImport(t, "visits", "customer,visit date,status,notes,rep\nERP-1001,01/09/2026,done,ok,dimitra@merc-demo.example\n");
    expect(ok(await handle(sysCtx(t, v.storage, { import_id: v.id })))).toEqual({ rows_imported: 1, rows_with_issues: 0 });
    expect(await t.db.visit.findOne({ planned_date: "2026-09-01", rep_id: IDS.dimitra })).toMatchObject({ status: "done", origin: "manual", outcome: "ok" });
  });
  it("a write failure becomes a row issue (the rest still imports); idempotent once imported; unconfirmed imports are refused", async () => {
    const t = kit();
    const { id, storage } = await confirmedImport(t, "products", "sku,name,unit,price\nP-1,A,kg,1\nP-2,B,kg,2\n");
    const impl = makeImpl({ storage });
    const sys = await t.system("procedure");
    const origInsert = t.tables.insert.bind(t.tables);
    let failed = false;
    (t.tables as any).insert = async (table: string, data: any) => { if (!failed && table.endsWith(".product")) { failed = true; throw Object.assign(new Error("boom"), { status: 400 }); } return origInsert(table, data); };
    const r = await impl({ req: { import_id: id }, db: t.db, me: sys, platform: t.platform });
    expect(r).toEqual({ rows_imported: 1, rows_with_issues: 1 });
    expect((await t.db.import_row_issue.all({ import_id: id }))[0]!.detail).toMatch(/not imported/);
    expect(await impl({ req: { import_id: id }, db: t.db, me: sys, platform: t.platform })).toEqual(r);
    const fresh = await t.db.data_import.insert({ uploaded_by: IDS.thanasis, data_type: "products", status: "preview", is_baseline: false } as any);
    expect(errCode(await handle(sysCtx(t, storage, { import_id: fresh.id })))).toBe("validation_failed");
    expect(errCode(await handle(sysCtx(t, storage, { import_id: "00000000-0000-4000-8000-000000000000" })))).toBe("not_found");
  });

  it("functions/import-apply/handler.gen.js is the current bundle (run `pnpm bundle import-apply` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "import-apply", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("import-apply"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
