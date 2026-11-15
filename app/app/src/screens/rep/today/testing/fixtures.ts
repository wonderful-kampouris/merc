import type { FunctionResponseMap, VisitSummary } from "../../../../contracts";

export const MILTOS = "59b5e454-cc4b-5fab-939b-a50c78e8aa9b";
export const LOFOS = "24d14591-c8c2-5885-819a-c5e997f6cad0";
/** Seed ids (packages/contracts seed), so fixtures line up with dev seed data. */
export const AVRA = "ef86a932-3241-51c8-b7be-1df72dbf74f9";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const visit = (n: number, name: string, accountId: string, pos: number | null, status: VisitSummary["status"] = "planned", date = "2026-11-15"): VisitSummary => ({
  visit_id: uuid(n),
  account: { id: accountId, name, account_type: "customer", postal_code: "15231", city: "Chalandri" },
  planned_date: date,
  route_position: pos,
  status,
  purpose: "routine",
  reason: n === 2 ? "Hasn't ordered in 12 days" : null,
});

export const todayResult = (date = "2026-11-15"): FunctionResponseMap["today-get"] => ({
  date,
  visits: [visit(2, "Bistro Lofos", LOFOS, 2, "planned", date), visit(1, "Café Miltos", MILTOS, 1, "done", date), visit(3, "Café Avra", AVRA, 3, "planned", date)],
  briefing_id: uuid(90),
  pending_recordings_hint: 1,
});

export const briefingResult = (date = "2026-11-15"): FunctionResponseMap["briefing-get"] => ({
  briefing_id: uuid(90),
  date,
  status: "generated",
  script_text: "Good morning. Three stops today. Lofos has not ordered in 12 days.",
  items: [
    { position: 2, item_type: "alert", display_text: "Lofos: going quiet, 12 days without an order" },
    { position: 1, item_type: "visit", display_text: "Start at Café Miltos: grinder problem follow-up" },
  ],
});

export const planResult = (date = "2026-11-16"): FunctionResponseMap["visit-plan-get"] => ({
  plan_id: uuid(80),
  week_start: "2026-11-16",
  status: "accepted",
  days: [{ date, visits: [visit(5, "Bakery Ilios", uuid(55), 1, "planned", date)] }],
});

export const performanceResult = (): FunctionResponseMap["my-performance"] => ({
  targets: [
    { target_id: uuid(70), metric: "revenue", period_start: "2026-11-01", period_end: "2026-11-30", target_value: 1800000, actual_value: 1260000, pct: 70, days_left: 15 },
    { target_id: uuid(71), metric: "visits", period_start: "2026-11-01", period_end: "2026-11-30", target_value: 110, actual_value: 48, pct: 43.6, days_left: 15 },
  ],
  visits_done: 12,
  revenue_minor: 384000,
  new_customers: 1,
  spoken_summary: "You are at 70% of revenue.",
});

const order = (n: number, date: string, kg: number): FunctionResponseMap["visit-card-get"]["recent_orders"][number] => ({
  order_id: uuid(100 + n),
  order_date: date,
  status: "confirmed",
  total_minor: kg * 1950,
  lines: [{ product_id: uuid(200), name: "Espresso Classico 1kg", quantity: kg, unit: "kg" }],
});

export const miltosCard = (): FunctionResponseMap["visit-card-get"] => ({
  kind: "customer",
  account: { id: MILTOS, name: "Café Miltos", account_type: "customer", postal_code: "15231", city: "Chalandri" },
  contacts: [{ contact_id: uuid(300), full_name: "Miltos Papadakis", role_title: "Owner", is_decision_maker: true, phone: "+306901000000" }],
  open_problems: [{ problem_id: uuid(400), description: "Grinder is making noise", status: "open", due_date: "2026-11-17" }],
  open_tasks: [{ task_id: uuid(500), title: "Bring the grinder technician", due_at: "2026-11-17T09:00:00.000Z", is_customer_promise: true }],
  recent_orders: [order(1, "2026-11-09", 12), order(2, "2026-10-26", 12), order(3, "2026-10-12", 10)],
  metrics: { avg_order_interval_days: 14, days_since_last_order: 6, risk_score: 10, risk_reasons: ["open_problem"] },
  alerts: [{ alert_id: uuid(600), type: "problem_open", message: "Grinder problem open for 8 days" }],
  suggested_products: [{ product_id: uuid(201), name: "Espresso Nuovo Blend 1kg", why: "Campaign this week, fits their espresso volume" }],
  campaigns: [{ campaign_id: uuid(700), title: "Espresso Nuovo to cafés", message: "Offer a 1kg trial bag." }],
  how_to_talk: "Miltos is direct; start with the grinder fix, then the order.",
  dossier: null,
  pitch: null,
  spoken_summary: "Café Miltos orders 12 kg of Espresso Classico every two weeks. The grinder problem is still open; the technician visit is promised for Tuesday.",
});

export const avraCard = (): FunctionResponseMap["visit-card-get"] => ({
  kind: "prospect",
  account: { id: AVRA, name: "Café Avra", account_type: "prospect", postal_code: "15232", city: "Chalandri" },
  contacts: [{ contact_id: uuid(301), full_name: "Yannis Avramidis", role_title: "Owner", is_decision_maker: true, phone: "+306901000039" }],
  open_problems: [],
  open_tasks: [],
  recent_orders: [],
  metrics: { risk_reasons: [] },
  alerts: [],
  suggested_products: [],
  campaigns: [],
  how_to_talk: null,
  dossier: {
    summary: "Specialty café, opened 8 months ago, brunch menu, ~60 seats.",
    price_level: "mid",
    facts: [{ fact_type: "current_brand", value: "Serves BlueBean espresso", source_url: "https://www.instagram.com/cafe.avra/", retrieved_at: "2026-11-10T10:00:00.000Z" }],
    competitor_brands: ["BlueBean"],
  },
  pitch: {
    opening_line: "Your brunch crowd deserves an espresso that keeps up.",
    arguments: ["Fresher roast than BlueBean, delivered weekly", "Free barista training for the team", "Trial bag of Espresso Nuovo at no cost"],
    products: [{ product_id: uuid(201), name: "Espresso Nuovo Blend 1kg", why: "Trial bag" }],
    objections: [{ objection: "We are happy with BlueBean", answer: "Run a one-week side by side with the trial bag." }],
  },
  spoken_summary: "Café Avra is a specialty café that serves BlueBean. Lead with the free trial bag.",
});
