import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createDb, mapTableError, MercError, TABLES, toApiError, type TableName } from "../src/index";
import { validateError, ERROR_STATUS as CONTRACT_STATUS } from "../../../packages/contracts/src/index";
import { ERROR_STATUS } from "../src/errors";
import { seeded, IDS } from "./fake-tables";

const catchErr = async (p: Promise<unknown>): Promise<MercError> => {
  try { await p; } catch (e) { return e as MercError; }
  throw new Error("expected rejection");
};

describe("typed table repos", () => {
  it("has one repo per contract table, schema-qualified", () => {
    const db = createDb(seeded(), IDS.org);
    const names = Object.keys(TABLES) as TableName[];
    expect(names.length).toBe(readdirSync(new URL("../../../spec/contracts/tables/", import.meta.url)).filter((f) => f.endsWith(".json") && !f.startsWith("_")).length);
    for (const n of names) expect(db[n].qualified).toBe(`merc.${n}`);
  });

  it("CRUD round trip (insert/get/update/list/count/delete)", async () => {
    const db = createDb(seeded(), IDS.org);
    const c = await db.contact.insert({ account_id: IDS.miltos, full_name: "Test Person", is_decision_maker: false } as any);
    expect(c.id).toMatch(/[0-9a-f-]{36}/);
    expect((await db.contact.require(c.id)).full_name).toBe("Test Person");
    const u = await db.contact.update(c.id, { full_name: "Renamed" });
    expect(u.full_name).toBe("Renamed");
    expect((await db.contact.list({ account_id: IDS.miltos, full_name: "Renamed" })).total).toBe(1);
    expect(await db.contact.count({ full_name: "Renamed" })).toBe(1);
    await db.contact.delete(c.id);
    expect(await db.contact.get(c.id)).toBeNull();
  });

  it("filters org-scoped tables by org and stamps org_id on insert", async () => {
    const f = seeded();
    const mine = createDb(f, IDS.org), other = createDb(f, "00000000-0000-4000-8000-000000000000");
    expect((await mine.account.list({}, { limit: 1000 })).total).toBe(40);
    expect((await other.account.list()).total).toBe(0);
    expect(await other.account.get(IDS.miltos)).toBeNull();
    expect((await catchErr(other.account.require(IDS.miltos))).code).toBe("not_found");
    const t = await mine.territory.insert({ name: "Merc Test Zone" });
    expect(t.org_id).toBe(IDS.org);
    expect((await catchErr(mine.territory.insert({ name: "X", org_id: "00000000-0000-4000-8000-000000000000" })))).toMatchObject({ code: "forbidden" });
    expect((await catchErr(mine.territory.update(t.id, { org_id: "00000000-0000-4000-8000-000000000000" })))).toMatchObject({ code: "forbidden" });
    expect(f.calls.some((c) => c.includes('"org_id"'))).toBe(true);
  });

  it("validates writes: unknown column, required, enum, types", async () => {
    const db = createDb(seeded(), IDS.org);
    const e1 = await catchErr(db.account.insert({ name: "A", account_type: "partner", source: "manual", bogus: 1 } as any));
    expect(e1.code).toBe("validation_failed");
    expect((e1.details as any).errors).toEqual(expect.arrayContaining(["bogus: unknown column", "account_type: must be one of prospect, customer, lost"]));
    const e2 = await catchErr(db.account.insert({ account_type: "prospect", source: "manual" } as any));
    expect((e2.details as any).errors).toContain("name: required");
    const e3 = await catchErr(db.account.update(IDS.miltos, { lat: "north" as any }));
    expect((e3.details as any).errors).toContain("lat: expected number");
  });

  it("REQ-CORE-007: rejects floats in *_minor table columns and percentages outside 0-100", async () => {
    const db = createDb(seeded(), IDS.org);
    const minorTable = (Object.keys(TABLES) as TableName[]).find((n) => Object.keys(TABLES[n].columns).some((c) => c.endsWith("_minor")))!;
    const minorCol = Object.keys(TABLES[minorTable].columns).find((c) => c.endsWith("_minor"))!;
    const row = (await db[minorTable].list({}, { limit: 1 })).items[0] as any;
    const e = await catchErr((db[minorTable] as any).update(row.id, { [minorCol]: 12.5 }));
    expect(e.code).toBe("validation_failed");
    expect((e.details as any).errors[0]).toMatch(/integer in minor units/);
    const pctTable = (Object.keys(TABLES) as TableName[]).find((n) => Object.keys(TABLES[n].columns).some((c) => c.endsWith("_pct")))!;
    const pctCol = Object.keys(TABLES[pctTable].columns).find((c) => c.endsWith("_pct"))!;
    const prow = (await db[pctTable].list({}, { limit: 1 })).items[0] as any;
    expect((await catchErr((db[pctTable] as any).update(prow.id, { [pctCol]: 150 }))).code).toBe("validation_failed");
  });

  it("unique natural keys -> conflict by pre-check, without calling insert", async () => {
    const f = seeded();
    const db = createDb(f, IDS.org);
    const e = await catchErr(db.territory.insert({ name: "North" }));
    expect(e.code).toBe("conflict");
    expect(f.calls.filter((c) => c.startsWith("insert")).length).toBe(0);
  });

  it("a platform 500 is conflict only after a confirmed unique clash", async () => {
    const http500 = () => Object.assign(new Error("Internal server error"), { status: 500 });
    // bare 500 without a re-read: never assumed to be a clash
    expect(mapTableError(http500(), TABLES.territory, "insert").code).toBe("upstream_failed");
    expect(mapTableError(http500(), TABLES.organization, "insert").code).toBe("upstream_failed");

    // 500 and the re-read finds no clashing row -> upstream_failed (e.g. a real server fault)
    const f = seeded();
    const db = createDb(f, IDS.org);
    f.failNextWrite = http500();
    expect((await catchErr(db.territory.insert({ name: "Brand New Zone" }))).code).toBe("upstream_failed");

    // lost race: the pre-check passed, then another writer inserted the same key -> 500 -> re-read confirms
    const racer = createDb(f, IDS.org);
    const orig = f.insert.bind(f);
    let raced = false;
    f.insert = async (q, data) => {
      if (!raced && q === "merc.territory") { raced = true; await orig(q, { ...data }); }
      return orig(q, data);
    };
    const e = await catchErr(racer.territory.insert({ name: "Race Zone" }));
    expect(e.code).toBe("conflict");
    expect(e.details).toMatchObject({ confirmed_after: 500, columns: expect.any(Array) });

    // update path: a 500 with no clash stays upstream_failed
    const t = (await db.territory.list({ name: "Race Zone" })).items[0]!;
    f.failNextWrite = http500();
    expect((await catchErr(db.territory.update(t.id, { name: "Race Zone 2" }))).code).toBe("upstream_failed");
  });

  it("maps FK misses to validation_failed and restrict deletes to conflict", async () => {
    const db = createDb(seeded(), IDS.org);
    const e = await catchErr(db.contact.insert({ account_id: "00000000-0000-4000-8000-000000000001", full_name: "Ghost", is_decision_maker: false } as any));
    expect(e.code).toBe("validation_failed");
    expect((await catchErr(db.account_category.delete((await db.account.require(IDS.miltos)).category_id!))).code).toBe("conflict");
  });

  it("REQ-CORE-008: 404/403/422/409 errors match the Error contract with stable statuses", async () => {
    expect(ERROR_STATUS).toEqual(CONTRACT_STATUS);
    const db = createDb(seeded(), IDS.org);
    const errs = [
      await catchErr(db.account.require("00000000-0000-4000-8000-000000000002")),
      await catchErr(db.territory.insert({ name: "X", org_id: "00000000-0000-4000-8000-000000000000" })),
      await catchErr(db.account.update(IDS.miltos, { account_type: "nope" as any })),
      await catchErr(db.territory.insert({ name: "North" })),
    ];
    expect(errs.map((e) => e.status)).toEqual([404, 403, 422, 409]);
    for (const e of errs) expect(validateError(toApiError(e)).ok).toBe(true);
  });
});
