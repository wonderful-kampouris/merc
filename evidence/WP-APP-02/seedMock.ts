// Screenshot-only overlay for app/app/src/lib/client.ts's "../contracts" import (see vite.shots.config.mjs).
// Answers the WP-APP-02 screen functions with seed-shaped, contract-valid fixtures (Café Miltos, Café Avra and Bistro Lofos,
// using their seed ids and seed text) instead of the generic "<field> sample" values. Every other slug uses the contract mock.
import * as contracts from "../../app/app/src/contracts/index.ts";
import type { FunctionSlug, MockOptions, MockReply, VisitSummary } from "../../app/app/src/contracts/index.ts";
import { AVRA, LOFOS, MILTOS, avraCard, briefingResult, miltosCard, performanceResult, planResult } from "../../app/app/src/screens/rep/today/testing/fixtures.ts";

export * from "../../app/app/src/contracts/index.ts";

const day = new Date().toISOString().slice(0, 10);
const ref = (id: string, name: string, account_type: "customer" | "prospect", postal_code: string, distance_m: number, reason: string | null) =>
  ({ id, name, account_type, postal_code, city: "Chalandri", distance_m, reason });
const stop = (n: number, account: ReturnType<typeof ref>, purpose: string): VisitSummary => ({
  visit_id: `00000000-0000-4000-8000-00000000000${n}`, account, planned_date: day, route_position: n, status: "planned", purpose, reason: account.reason,
});
const miltos = ref(MILTOS, "Café Miltos", "customer", "15231", 450, "Open problem: grinder noise");
const avra = ref(AVRA, "Café Avra", "prospect", "15232", 1200, "Prospect, pitch ready");
const lofos = ref(LOFOS, "Bistro Lofos", "customer", "15124", 2600, "No order in 12 days");

const fixtures: Partial<Record<FunctionSlug, (body: Record<string, unknown>) => unknown>> = {
  "today-get": () => ({
    date: day,
    visits: [stop(1, miltos, "Open issue: grinder noise; espresso deal"), stop(2, avra, "First visit, prospect pitch ready"), stop(3, lofos, "routine")],
    briefing_id: "00000000-0000-4000-8000-000000000090",
    pending_recordings_hint: 0,
  }),
  "briefing-get": () => ({
    ...briefingResult(day),
    items: [
      { position: 1, item_type: "visit", display_text: "Start at Café Miltos: the grinder is making noise, and the espresso deal is in negotiation" },
      { position: 2, item_type: "visit", display_text: "Café Avra (prospect) serves BlueBean; lead with the free trial bag" },
      { position: 3, item_type: "alert", display_text: "Bistro Lofos: going quiet, 12 days without an order" },
    ],
  }),
  "visit-plan-get": () => planResult(),
  "my-performance": () => performanceResult(),
  "accounts-list": (b) => {
    const all = [miltos, avra, lofos];
    const type = b.account_type as string | undefined;
    const items = all.filter((a) => (!type || a.account_type === type) && (!b.q || a.name.toLowerCase().includes(String(b.q).toLowerCase())));
    return { items, page: { page: 1, limit: 50, total: items.length } };
  },
  "visit-card-get": (b) => (b.account_id === AVRA ? avraCard() : b.account_id === MILTOS ? miltosCard() : undefined),
  "account-get": (b) =>
    b.account_id === MILTOS
      ? { account: { phone: "+302106000000", email: "info@miltos.example.gr", website: "https://miltos.example.gr", street: "Odos Café 10", postal_code: "15231" }, contacts: [], deals: [{ id: "50bce864-2842-50e6-8615-503cf2fe5c6f", title: "Espresso 20kg monthly", stage_code: "negotiation", amount_minor: 380000, closed_at: null }], activities: [] }
      : b.account_id === AVRA
        ? { account: { phone: "+302106000274", email: "info@avra.example.gr", website: "https://cafeavra.example.gr", street: "Odos Café 12", postal_code: "15232" }, contacts: [], deals: [{ id: "895d08f7-9a22-581a-b001-b69c8679efa2", title: "Opening order", stage_code: "qualified", amount_minor: 150000, closed_at: null }], activities: [] }
        : undefined,
};

export function callMock<S extends FunctionSlug>(slug: S, body: unknown = {}, opts: MockOptions = {}): MockReply<S> {
  const result = fixtures[slug]?.((body ?? {}) as Record<string, unknown>);
  if (result === undefined) return contracts.callMock(slug, body, opts);
  const v = contracts.validateResponse(slug, result);
  if (!v.ok) throw new Error(`seedMock ${slug} fixture is not contract-valid: ${JSON.stringify(v)}`);
  return { result: v.value, logs: ["seedMock"] } as MockReply<S>;
}
