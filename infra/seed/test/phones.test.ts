import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPhones } from "../src/load.ts";

const wuid = { nikos: "w-nikos", eleni: "w-eleni" };
const rows = (): Record<string, unknown>[] => [
  { wonderful_user_id: "w-nikos", phone: "+306900000003" },
  { wonderful_user_id: "w-eleni", phone: "+306900000002" },
];

test("phones overlay: no file leaves the seed unchanged", () => {
  const r = rows();
  assert.equal(applyPhones(r, wuid, null), 0);
  assert.deepEqual(r, rows());
});

test("phones overlay: listed users get the real phone; everyone else is never dialled", () => {
  const r = rows();
  assert.equal(applyPhones(r, wuid, { nikos: "+306900009999" }), 1);
  assert.deepEqual(r[0], { wonderful_user_id: "w-nikos", phone: "+306900009999", phone_channel_enabled: true });
  assert.deepEqual(r[1], { wonderful_user_id: "w-eleni", phone: "+306900000002", phone_channel_enabled: false });
});

test("phones overlay: a non-E.164 placeholder is ignored and disables the channel", () => {
  const r = rows();
  assert.equal(applyPhones(r, wuid, { nikos: "+30690000000X (placeholder)" }), 0);
  assert.equal(r[0].phone, "+306900000003");
  assert.equal(r[0].phone_channel_enabled, false);
});
