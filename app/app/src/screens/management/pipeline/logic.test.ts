import { expect, test } from "vitest";
import { seedRows } from "../../../contracts";
import { createClient } from "../../../lib/client";
import { SCREENS } from "../../../lib/routes";
import { applyMove, filterDeals, groupByStage, moveRequest, newDealRequest, STAGES, stageName, toDeal, weightedPipeline, type Deal } from "./logic";

const screen = SCREENS.find((s) => s.route === "/mgmt/pipeline")!;
const d = (id: string, stage_code: string, amount_minor: number, extra: Partial<Deal> = {}): Deal => ({ id, account_id: `a-${id}`, stage_code, title: `Deal ${id}`, amount_minor, ...extra });

test("stages come from the deal_stage lookup in sort order", () => {
  expect(STAGES.map((s) => s.code)).toEqual(["new", "qualified", "proposal", "negotiation", "won", "lost"]);
  expect(stageName("negotiation", "el")).toBe("Διαπραγμάτευση");
  expect(stageName("negotiation", "en")).toBe("Negotiation");
});

test("weighted pipeline = sum(amount x probability) over open stages (metrics.md#weighted-pipeline)", () => {
  const deals = [d("1", "new", 10000), d("2", "negotiation", 380000), d("3", "won", 999999), d("4", "lost", 50000)];
  expect(weightedPipeline(deals)).toBe(1000 + 266000);
});

test("the seed's open deals give the hand-computed weighted pipeline", () => {
  const deals = seedRows("deal").map((r) => toDeal(r)!);
  const prob = new Map(seedRows("deal_stage").map((s) => [s.code, s]));
  const hand = seedRows("deal").reduce((s, r) => {
    const st = prob.get(r.stage_code)!;
    return st.is_closed ? s : s + Math.round(Number(r.amount_minor) * Number(st.probability));
  }, 0);
  expect(weightedPipeline(deals)).toBe(hand);
  expect(hand).toBeGreaterThan(0);
});

test("grouping keeps lookup order and unknown stages at the end", () => {
  const cols = groupByStage([d("1", "proposal", 100), d("2", "proposal", 300), d("3", "mystery", 5)]);
  const proposal = cols.find((c) => c.stage.code === "proposal")!;
  expect(proposal).toMatchObject({ amount_minor: 400, weighted_minor: 200 });
  expect(cols.at(-1)!.stage.code).toBe("mystery");
});

test("normalize loosely typed rows", () => {
  expect(toDeal({ id: "x" })).toBeNull();
  expect(toDeal({ id: "x", account: { id: "a", name: "Café" }, amount_minor: 5 })).toMatchObject({ account_id: "a", account_name: "Café", stage_code: "new", amount_minor: 5 });
});

test("filters by text, stage and owner", () => {
  const deals = [d("1", "new", 1, { owner_id: "u1" }), d("2", "won", 1, { owner_id: "u2", title: "Espresso" })];
  expect(filterDeals(deals, { q: "espr", stage: null, owner: null }, () => undefined).map((x) => x.id)).toEqual(["2"]);
  expect(filterDeals(deals, { q: "", stage: "new", owner: null }, () => undefined).map((x) => x.id)).toEqual(["1"]);
  expect(filterDeals(deals, { q: "miltos", stage: null, owner: "u1" }, (id) => (id === "a-1" ? "Café Miltos" : undefined)).map((x) => x.id)).toEqual(["1"]);
});

test("move and new-deal bodies match deal-upsert", async () => {
  const client = createClient({ mock: true, invoker: { invokeFunction: async () => ({}) } }).forScreen(screen.functions);
  const deal = d("1", "new", 100, { account_id: "59b5e454-cc4b-5fab-939b-a50c78e8aa9b", id: "50bce864-2842-50e6-8615-503cf2fe5c6f" });
  expect(moveRequest(deal, "won")).toEqual({ deal_id: deal.id, account_id: deal.account_id, fields: { stage_code: "won" } });
  await expect(client.call("deal-upsert", moveRequest(deal, "won"))).resolves.toHaveProperty("deal_id");
  expect(newDealRequest({ account_id: "", title: "x", amount_eur: 10, stage_code: "new", expected_close_date: "", next_step: "" })).toBeNull();
  expect(newDealRequest({ account_id: "a", title: "x", amount_eur: 0, stage_code: "new", expected_close_date: "", next_step: "" })).toBeNull();
  const body = newDealRequest({ account_id: deal.account_id, title: " Beans ", amount_eur: 12.5, stage_code: "", expected_close_date: "2026-12-01", next_step: "" })!;
  expect(body).toEqual({ account_id: deal.account_id, fields: { title: "Beans", amount_minor: 1250, stage_code: "new", expected_close_date: "2026-12-01" } });
  await expect(client.call("deal-upsert", body)).resolves.toHaveProperty("deal_id");
  expect(applyMove([deal], deal.id, "won")[0]!.stage_code).toBe("won");
});

test("only the pipeline's app.json functions are callable", async () => {
  const client = createClient({ mock: true, invoker: { invokeFunction: async () => ({}) } }).forScreen(screen.functions);
  expect(screen.functions).toEqual(["accounts-list", "deals-list", "deal-upsert", "account-get", "team-list", "territories-list"]);
  expect((await client.call("team-list", {})).items.length).toBeGreaterThan(0);
  const list = await client.call("deals-list", { limit: 200 });
  expect(list.items.map(toDeal).every((x) => x !== null)).toBe(true);
  await expect(client.call("dashboard-kpis", { scope: "team", from: "2026-11-01", to: "2026-11-02" })).rejects.toMatchObject({ code: "forbidden" });
});
