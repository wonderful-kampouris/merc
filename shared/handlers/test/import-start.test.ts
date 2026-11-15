import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, makeImpl, GLOBAL_PIPELINE_ID, type StartDeps } from "../src/import-start";
import type { StorageLike } from "../src/import-analyze";
import { messyAccounts, toCsv, toXlsx } from "../../../procedures/import-pipeline/fixtures/make-fixtures";

function fakeStorage(init: Record<string, Uint8Array> = {}) {
  const files = new Map(Object.entries(init));
  const storage: StorageLike & { files: Map<string, Uint8Array> } = {
    files,
    upload: async (k, d) => { if (files.has(k)) throw new Error("validation-error: key in use"); files.set(k, d); return { key: k }; },
    download: async (k) => { const d = files.get(k); if (!d) throw new Error("not-found"); return { data: d }; },
  };
  return storage;
}
const b64 = (s: string | Uint8Array) => Buffer.from(typeof s === "string" ? Buffer.from(s, "utf8") : s).toString("base64");
const CSV = toCsv(messyAccounts().grid);
const ctxWith = (c: any, extra: Record<string, unknown>) => Object.assign(c, extra);
const run = (t: ReturnType<typeof kit>, deps: StartDeps, who: any, body: unknown) =>
  handle(ctxWith(t.fnCtx(who, body), { storage: deps.storage, automations: deps.automations ?? null }) as any);

describe("fn:import-start (REQ-IMP-001, REQ-IMP-003)", () => {
  it("admin uploads a messy CSV: file kept in storage, data_import created, analyzed inline to preview", async () => {
    const t = kit();
    const storage = fakeStorage();
    const r = ok(await run(t, { storage }, "thanasis", { data_type: "accounts", filename: "Πελάτες ERP 2026.csv", csv_base64: b64(CSV), is_baseline: true }));
    expect(validateResponse("import-start", r).ok).toBe(true);
    expect(r.status).toBe("preview");
    const imp = await t.db.data_import.require(r.import_id);
    expect(imp).toMatchObject({ uploaded_by: IDS.thanasis, data_type: "accounts", is_baseline: true, status: "preview", rows_total: 200 });
    expect(imp.file_ref).toBe(`merc/imports/${r.import_id}/Pelates_ERP_2026.csv`);
    expect(new TextDecoder().decode(storage.files.get(imp.file_ref!)!)).toBe(CSV);
    expect(await t.db.import_column_mapping.count({ import_id: r.import_id })).toBe(11);
  });
  it("accepts an .xlsx upload and a Custom Storage file_ref", async () => {
    const t = kit();
    const storage = fakeStorage({ "uploads/ext.xlsx": new Uint8Array(toXlsx(messyAccounts().grid)) });
    const a = ok(await run(t, { storage }, "thanasis", { data_type: "accounts", filename: "ext.xlsx", file_ref: "uploads/ext.xlsx" }));
    expect((await t.db.data_import.require(a.import_id))).toMatchObject({ file_ref: "uploads/ext.xlsx", rows_total: 200, is_baseline: false });
    const x = ok(await run(t, { storage }, "thanasis", { data_type: "accounts", filename: "c.xlsx", csv_base64: b64(new Uint8Array(toXlsx(messyAccounts().grid))) }));
    expect(x.status).toBe("preview");
  });
  it("starts the import-pipeline procedure when MERC_IMPORT_PROCEDURE_ID is set (status mapping, run id kept)", async () => {
    const t = kit({ globals: { [GLOBAL_PIPELINE_ID]: "proc-1" } });
    const calls: any[] = [];
    const r = ok(await run(t, { storage: fakeStorage(), automations: { invoke: async (o) => { calls.push(o); return { runId: "run-7" }; } } }, "thanasis", { data_type: "accounts", filename: "a.csv", csv_base64: b64(CSV) }));
    expect(r.status).toBe("mapping");
    expect(calls).toEqual([{ automationId: "proc-1", input: { import_id: r.import_id } }]);
    expect((await t.db.data_import.require(r.import_id)).procedure_run_id).toBe("run-7");
    expect(await t.db.import_column_mapping.count({ import_id: r.import_id })).toBe(0);
    // procedure not published -> inline fallback
    const f = ok(await run(t, { storage: fakeStorage(), automations: { invoke: async () => { throw new Error("not published"); } } }, "thanasis", { data_type: "accounts", filename: "a.csv", csv_base64: b64(CSV) }));
    expect(f.status).toBe("preview");
  });
  it("forbidden for reps and managers (gate import.manage) and without a user; a spoofed caller is ignored", async () => {
    const t = kit();
    const body = { data_type: "accounts", filename: "a.csv", csv_base64: b64(CSV) };
    expect(errCode(await run(t, { storage: fakeStorage() }, "nikos", body))).toBe("forbidden");
    expect(errCode(await run(t, { storage: fakeStorage() }, "eleni", body))).toBe("forbidden");
    expect(errCode(await run(t, { storage: fakeStorage() }, null, body))).toBe("forbidden");
    const r = ok(await run(t, { storage: fakeStorage() }, "thanasis", { ...body, caller: { user_id: IDS.nikos } }));
    expect((await t.db.data_import.require(r.import_id)).uploaded_by).toBe(IDS.thanasis);
  });
  it("bad input: no file, bad base64, unreadable file, bad key; no storage -> blocked; nothing is left behind", async () => {
    const t = kit();
    const s = fakeStorage();
    expect(errCode(await run(t, { storage: s }, "thanasis", { data_type: "accounts", filename: "a.csv" }))).toBe("validation_failed");
    expect(errCode(await run(t, { storage: s }, "thanasis", { data_type: "accounts", filename: "a.csv", csv_base64: "!!!" }))).toBe("validation_failed");
    expect(errCode(await run(t, { storage: s }, "thanasis", { data_type: "accounts", filename: "a.xls", csv_base64: b64(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4, 5])) }))).toBe("validation_failed");
    expect(errCode(await run(t, { storage: s }, "thanasis", { data_type: "accounts", filename: "a.csv", file_ref: "../etc" }))).toBe("validation_failed");
    expect(errCode(await run(t, { storage: s }, "thanasis", { data_type: "accounts", filename: "a.csv", file_ref: "merc/voice-logs/x.webm" }))).toBe("validation_failed");
    expect(errCode(await run(t, { storage: s }, "thanasis", { data_type: "nope", filename: "a.csv", csv_base64: b64(CSV) }))).toBe("validation_failed");
    const blockedOut = await run(t, { storage: null }, "thanasis", { data_type: "accounts", filename: "a.csv", csv_base64: b64(CSV) }) as any;
    expect(blockedOut.error.code).toBe("blocked_by_policy");
    expect(blockedOut.error.details.missing).toBe("context.storage");
    expect(await t.db.data_import.count()).toBe(0);
    expect(s.files.size).toBe(0);
  });
  it("makeImpl refuses system callers", async () => {
    const t = kit();
    const out = await makeImpl({ storage: fakeStorage() })({ req: { data_type: "accounts", filename: "a.csv", csv_base64: b64(CSV) }, db: t.db, me: await t.system("procedure"), platform: t.platform }).catch((e) => e);
    expect(out.code).toBe("validation_failed");
  });

  it("functions/import-start/handler.gen.js is the current bundle (run `pnpm bundle import-start` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "import-start", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("import-start"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
