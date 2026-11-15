import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { localDateTime, monthEnd, resolveRow, resolveToken, weekStart } from "../src/tokens.ts";
import { loadSeed, plan, sameValue } from "../src/seed.ts";
import { daysSince } from "../src/check.ts";

const ctx = { demoDay: "2026-11-18", tz: "Europe/Athens", wuid: { nikos: "wu-123" } }; // a Wednesday

test("@D relative dates", () => {
  assert.equal(resolveToken("@D", ctx), "2026-11-18");
  assert.equal(resolveToken("@D-12", ctx), "2026-11-06");
  assert.equal(resolveToken("@D+3", ctx), "2026-11-21");
  assert.equal(resolveToken("@D-400", ctx), "2025-10-14");
  assert.equal(resolveToken("@D-18", ctx), "2026-10-31"); // month boundary
});

test("@D-3@09:30 is local org time with the offset of that day (DST aware)", () => {
  assert.equal(resolveToken("@D-3@09:30", ctx, "datetime"), "2026-11-15T09:30:00+02:00");
  assert.equal(resolveToken("@D+1@12:00", ctx, "datetime"), "2026-11-19T12:00:00+02:00");
  assert.equal(resolveToken("@D-60@09:30", ctx, "datetime"), "2026-09-19T09:30:00+03:00"); // summer time
  assert.equal(Date.parse(String(resolveToken("@D-3@09:30", ctx, "datetime"))), Date.parse("2026-11-15T07:30:00Z"));
  assert.equal(resolveToken("@D", ctx, "datetime"), "2026-11-18T00:00:00+02:00");
  assert.equal(localDateTime("2026-03-29", 4, 0, "Europe/Athens"), "2026-03-29T04:00:00+03:00"); // DST switch day
  assert.throws(() => resolveToken("@D-3@09:30", ctx, "date"), /has a time/);
  assert.throws(() => resolveToken("@D-3@25:00", ctx, "datetime"), /bad time/);
});

test("@WEEK_START is the Monday of the demo week", () => {
  assert.equal(resolveToken("@WEEK_START", ctx), "2026-11-16");
  assert.equal(weekStart("2026-11-16"), "2026-11-16");
  assert.equal(weekStart("2026-11-22"), "2026-11-16"); // Sunday
});

test("@MONTH_START / @MONTH_END", () => {
  assert.equal(resolveToken("@MONTH_START", ctx), "2026-11-01");
  assert.equal(resolveToken("@MONTH_END", ctx), "2026-11-30");
  assert.equal(monthEnd("2028-02-10"), "2028-02-29");
  assert.equal(monthEnd("2026-12-31"), "2026-12-31");
});

test("@wuid:<key>", () => {
  assert.equal(resolveToken("@wuid:nikos", ctx, "string"), "wu-123");
  assert.throws(() => resolveToken("@wuid:nobody", ctx, "string"), /no Wonderful user id/);
});

test("non-tokens pass through; malformed tokens fail", () => {
  assert.equal(resolveToken("info@lofos.example.gr", ctx, "string"), "info@lofos.example.gr");
  assert.equal(resolveToken(42, ctx, "number"), 42);
  assert.equal(resolveToken(null, ctx), null);
  assert.throws(() => resolveToken("@Dx", ctx), /malformed/);
  assert.throws(() => resolveToken("@D-1", ctx, "string"), /string column/);
  assert.deepEqual(resolveRow({ a: "@D-1", b: "x" }, { a: "date", b: "string" }, ctx), { a: "2026-11-17", b: "x" });
});

const contracts = resolve(import.meta.dirname, "../../../spec/contracts");
const wuid = Object.fromEntries(["thanasis", "eleni", "nikos", "maria", "giorgos", "dimitra"].map((k) => [k, `w-${k}`]));

test("whole seed resolves deterministically with no tokens left", () => {
  const a = loadSeed(contracts, { ...ctx, wuid });
  const b = loadSeed(contracts, { ...ctx, wuid });
  assert.deepEqual(a, b);
  assert.equal(a[0].name, "action_type");
  assert.ok(!JSON.stringify(a).match(/"@(D|WEEK|MONTH|wuid)/));
  assert.deepEqual(a.find((t) => t.name === "app_user")!.selfRefs, ["manager_id"]);
});

test("Bistro Lofos: 12 days since last confirmed order on the demo day", () => {
  const s = loadSeed(contracts, { ...ctx, wuid });
  const lofos = s.find((t) => t.name === "account")!.rows.find((r) => r.name === "Bistro Lofos")!;
  const dates = s.find((t) => t.name === "sales_order")!.rows
    .filter((r) => r.account_id === lofos.id && r.status === "confirmed").map((r) => String(r.order_date));
  assert.equal(daysSince(ctx.demoDay, dates), 12);
});

test("plan: insert missing, update changed, skip identical (datetimes as instants)", () => {
  const t = { name: "x", pk: "id", selfRefs: [], types: { id: "auto_uuid", at: "datetime", n: "number", s: "string" } as Record<string, string>,
    rows: [{ id: "1", at: "2026-11-15T09:30:00+02:00", n: 1, s: null }, { id: "2", n: 2 }, { id: "3", n: 3 }] };
  const p = plan(t, [
    { id: "1", data: { id: "1", at: "2026-11-15T07:30:00Z", n: 1 } },
    { id: "2", data: { id: "2", n: 5 } },
  ]);
  assert.deepEqual(p.insert.map((r) => r.id), ["3"]);
  assert.deepEqual(p.update, [{ id: "2", data: { n: 2 } }]);
  assert.equal(p.same, 1);
  assert.ok(sameValue("2026-11-15", "2026-11-15T00:00:00Z", "date"));
});
