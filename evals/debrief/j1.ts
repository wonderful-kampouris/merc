// J1 fixture (SPEC J1: Nikos at Café Miltos): the Greek debrief and a model output for it, used by the
// handler tests in shared/handlers/test and by the offline eval run. Seed ids from spec/contracts/seed.
import type { DebriefOutput } from "../../shared/llm/src/index";

export const IDS_J1 = {
  PROBLEM: "e5198444-d143-5b8d-a174-70391f0aa839",
  DEAL: "50bce864-2842-50e6-8615-503cf2fe5c6f",
  CONTACT: "416bbb0b-46bb-5b8d-be2c-d5cc354b6142",
  CAMPAIGN: "006021ba-1b63-5646-9d18-85a40098c0c9",
  AROMA: "94cc0e65-3b44-5d48-b419-32e51aa11446",
  NUOVO: "b28bc378-ec47-55d6-a414-b09ac0dacc3d",
} as const;
const { PROBLEM, DEAL, CAMPAIGN, NUOVO } = IDS_J1;

export const J1 =
  "Ήμουν στο Café Miltos. Ο μύλος κάνει ακόμα θόρυβο, θα στείλουμε τεχνικό. " +
  "Υποσχέθηκα στον Μίλτο να του φέρω δείγματα Espresso Nuovo την Πέμπτη. Του έδειξα την καμπάνια Espresso Nuovo και του άρεσε. " +
  "Η Aroma του προσφέρει 15% φθηνότερα. Για τη συμφωνία των 20 κιλών λέει ότι κλείνουμε στα 4.000 ευρώ. " +
  "Βάλε και μια παραγγελία για δώδεκα κιλά Espresso Nuovo. Στείλε του ένα email να τον ευχαριστήσω.";

export const empty = (): DebriefOutput => ({
  language: "el", note: "", problems: [], tasks: [], deal_update: { deal_id: null, new_deal_title: null, stage_code: null, amount_minor: null, next_step: null, expected_close_date: null, evidence: "" },
  order_intent: { lines: [], requested_discount_pct: null, evidence: "" }, competitor_signals: [], contacts: [], campaigns_pitched: [],
  follow_up: { intent: "", channel: "email", contact_name: null, evidence: "" }, visit_done: true, missing_fields: [],
} as DebriefOutput);

export function j1Output(): DebriefOutput {
  return {
    ...empty(),
    note: "Επίσκεψη στο Café Miltos: ο μύλος κάνει θόρυβο, η Aroma δίνει χαμηλότερη τιμή, ενδιαφέρον για Espresso Nuovo.",
    problems: [{ existing_problem_id: PROBLEM, description: "Grinder is making noise", status: "in_progress", due_date: null, evidence: "Ο μύλος κάνει ακόμα θόρυβο" }],
    tasks: [{ title: "Δείγματα Espresso Nuovo στον Μίλτο", due_at: "2026-11-19T09:00:00+02:00", is_customer_promise: true, evidence: "να του φέρω δείγματα Espresso Nuovo την Πέμπτη" }],
    deal_update: { deal_id: DEAL, new_deal_title: null, stage_code: "won", amount_minor: 400000, next_step: null, expected_close_date: null, evidence: "κλείνουμε στα 4.000 ευρώ" },
    order_intent: { lines: [{ product_id: NUOVO, product_text: "Espresso Nuovo", quantity: 12, unit: "kg" }], requested_discount_pct: null, evidence: "παραγγελία για δώδεκα κιλά Espresso Nuovo" },
    competitor_signals: [{ competitor_name: "Aroma", statement: "Προσφέρει 15% φθηνότερα", price_delta_pct: -15, evidence: "Η Aroma του προσφέρει 15% φθηνότερα" }],
    campaigns_pitched: [{ campaign_id: CAMPAIGN, evidence: "Του έδειξα την καμπάνια Espresso Nuovo" }],
    follow_up: { intent: "Ευχαριστώ για τη συνάντηση", channel: "email", contact_name: "Μίλτος", evidence: "Στείλε του ένα email να τον ευχαριστήσω" },
  } as DebriefOutput;
}

