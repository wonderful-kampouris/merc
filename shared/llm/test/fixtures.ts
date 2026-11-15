import type { LlmInputMap, DebriefOutput } from "../src/index.js";

export const UTTERANCE =
  "Ήμουν στον Φούρνο Παπαδόπουλου. Ο Γιώργος είπε ότι η Aroma τους έδωσε 15% φθηνότερα. " +
  "Βάλε κάτω δώδεκα κιλά αλεύρι τύπου 70. Θα του φέρω δείγματα την Πέμπτη. " +
  "Η συμφωνία για τον φούρνο πάει για 1.500 ευρώ το μήνα.";

export const debriefInput: LlmInputMap["debrief_extraction"] = {
  utterance: UTTERANCE,
  language_hint: "el",
  today: "2026-11-15",
  account: { id: "11111111-1111-4111-8111-111111111111", name: "Φούρνος Παπαδόπουλου", account_type: "customer" },
  open_problems: [],
  open_deals: [],
  products: [{ product_id: "22222222-2222-4222-8222-222222222222", name: "Αλεύρι τύπου 70", unit: "kg", aliases: ["αλεύρι 70"] }],
  active_campaigns: [],
  contacts: [],
  competitors: [],
} as unknown as LlmInputMap["debrief_extraction"];

export function debriefOutput(): DebriefOutput {
  return {
    language: "el",
    note: "Επίσκεψη στον Φούρνο Παπαδόπουλου.",
    problems: [],
    tasks: [{ title: "Δείγματα", due_at: "2026-11-19T09:00:00+02:00", is_customer_promise: true, evidence: "θα του φέρω δείγματα την πέμπτη" }],
    deal_update: { deal_id: null, new_deal_title: "Φούρνος", stage_code: null, amount_minor: 150000, next_step: null, expected_close_date: null, evidence: "πάει για 1.500 ευρώ το μήνα" },
    order_intent: { lines: [{ product_id: "22222222-2222-4222-8222-222222222222", product_text: "αλεύρι τύπου 70", quantity: 12, unit: "kg" }], requested_discount_pct: null, evidence: "Βάλε κάτω δώδεκα κιλά αλεύρι" },
    competitor_signals: [{ competitor_name: "Aroma", statement: "15% φθηνότερα", price_delta_pct: -15, evidence: "η Aroma τους έδωσε 15% φθηνότερα" }],
    contacts: [{ existing_contact_id: null, full_name: "Γιώργος", role_title: null, phone: null, email: null, is_decision_maker: null, evidence: "Ο Γιώργος είπε" }],
    campaigns_pitched: [],
    follow_up: { intent: "", channel: "email", contact_name: null, evidence: "" },
    visit_done: true,
    missing_fields: [],
  } as DebriefOutput;
}
