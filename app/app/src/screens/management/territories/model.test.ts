import { describe, expect, it } from "vitest";
import { mockClient, screenOf } from "../settings/testkit";
import {
  emptyTransfer, enrichFromSeed, formFromTerritory, parsePostalCodes, parseTerritories, repOptions, toTerritoryUpsert, toTransfer,
  validateTerritory, validateTransfer,
} from "./model";

const NIKOS = "d72bccf8-f36c-5abf-8d0d-142783f090cd";
const DIMITRA = "27f8d8e3-7f84-5b9f-90e1-7d3fab3d9b22";
const LOFOS = "24d14591-c8c2-5885-819a-c5e997f6cad0";

describe("territories model", () => {
  it("parses postal codes and reps in either shape", () => {
    const [t] = parseTerritories([{ id: "t1", name: "North", postal_codes: ["15231", { postal_code: "15232" }], reps: [{ user_id: NIKOS, full_name: "Nikos" }], rep_ids: [NIKOS, DIMITRA] }]);
    expect(t!.postal_codes).toEqual(["15231", "15232"]);
    expect(t!.reps).toEqual([{ id: NIKOS, name: "Nikos" }, { id: DIMITRA, name: "" }]);
    expect(repOptions([t!]).map((r) => r.name)).toEqual(["27f8d8e3", "Nikos"]);
  });
  it("mock enrichment fills codes and rep names from the seed", () => {
    const [north] = enrichFromSeed(parseTerritories([{ id: "76b55561-9135-5c55-ad43-34661bffd9d9", name: "North" }]));
    expect(north!.postal_codes).toContain("15231");
    expect(north!.reps.every((r) => r.name)).toBe(true);
  });
  it("postal codes: 5 digits, de-duplicated, invalid ones reported", () => {
    expect(parsePostalCodes("15231, 15232\n15231;abc 1523")).toEqual({ valid: ["15231", "15232"], invalid: ["abc", "1523"] });
  });
  it("territory form validation and body", () => {
    const f = { ...formFromTerritory({ id: "t1", name: "North", manager_id: null, default_rep_id: NIKOS, postal_codes: ["15231"], reps: [{ id: NIKOS, name: "N" }] }) };
    expect(validateTerritory(f)).toEqual([]);
    expect(validateTerritory({ ...f, name: " ", postal_text: "x", rep_ids: [] })).toEqual(["name", "postal", "default_rep"]);
    expect(toTerritoryUpsert({ ...f, postal_text: "15231 15233" })).toMatchObject({ territory_id: "t1", postal_codes: ["15231", "15233"], rep_ids: [NIKOS] });
  });
  it("REQ-SET-003: transfer validation and request", () => {
    expect(validateTransfer(emptyTransfer())).toEqual(["from", "to"]);
    expect(validateTransfer({ ...emptyTransfer(), from_rep_id: NIKOS, to_rep_id: NIKOS })).toEqual(["same"]);
    const one = { ...emptyTransfer(), from_rep_id: NIKOS, to_rep_id: DIMITRA, all_accounts: false, account_text: `${LOFOS}\n${LOFOS}`, reason: " Nikos left " };
    expect(validateTransfer(one)).toEqual([]);
    expect(toTransfer(one)).toEqual({ from_rep_id: NIKOS, to_rep_id: DIMITRA, account_ids: [LOFOS], all_accounts: false, reason: "Nikos left" });
    expect(validateTransfer({ ...one, account_text: "lofos" })).toEqual(["account_ids"]);
    expect(toTransfer({ ...one, all_accounts: true })).toMatchObject({ account_ids: [], all_accounts: true });
  });
  it("calls only its app.json functions against the mocks", async () => {
    const { client, calls } = mockClient(screenOf("/mgmt/territories"));
    const ts = enrichFromSeed(parseTerritories((await client.call("territories-list", {})).items as never));
    expect(ts.map((t) => t.name)).toEqual(["North", "Center"]);
    await client.call("territory-upsert", toTerritoryUpsert(formFromTerritory(ts[0]!)));
    const r = await client.call("assignments-transfer", toTransfer({ ...emptyTransfer(), from_rep_id: NIKOS, to_rep_id: DIMITRA }));
    expect(r.moved).toBeTypeOf("number");
    expect(calls).toEqual(["territories-list", "territory-upsert", "assignments-transfer"]);
  });
});
