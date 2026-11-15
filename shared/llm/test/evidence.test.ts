import { describe, expect, it } from "vitest";
import { normalizeText, evidenceInUtterance, extractNumbers, numberInText, numbersNotInEvidence, unknownNumbers, enforceDebriefEvidence, validateSchema, llmContracts, defSchemas } from "../src/index.js";
import { UTTERANCE, debriefOutput } from "./fixtures.js";

describe("normalizeText / evidenceInUtterance", () => {
  it("strips accents, case, final sigma and punctuation", () => {
    expect(normalizeText("Ο ΓΙΏΡΓΟΣ, είπε: «ΝΑΙ»!")).toBe("ο γιωργοσ ειπε ναι");
    expect(normalizeText("Θα  του φέρω\nδείγματα")).toBe("θα του φερω δειγματα");
  });
  it("accepts normalized substrings and rejects paraphrases", () => {
    expect(evidenceInUtterance("θα του φερω ΔΕΙΓΜΑΤΑ την Πέμπτη", UTTERANCE)).toBe(true);
    expect(evidenceInUtterance("«η Aroma τους έδωσε 15% φθηνότερα»", UTTERANCE)).toBe(true);
    expect(evidenceInUtterance("θα του φέρω δείγματα την Παρασκευή", UTTERANCE)).toBe(false);
    expect(evidenceInUtterance("", UTTERANCE)).toBe(false);
  });
  it("matches whole words only", () => {
    expect(evidenceInUtterance("12 κιλά", "βάλε 120 κιλά")).toBe(false);
    expect(evidenceInUtterance("ρο", "φούρνος")).toBe(false);
  });
});

describe("numbers", () => {
  it("extracts digits, decimals, thousands and percents", () => {
    expect(extractNumbers("12 κιλά")).toContain(12);
    expect(extractNumbers("1,5 kg")).toContain(1.5);
    expect(extractNumbers("1.500 ευρώ")).toContain(1500);
    expect(extractNumbers("15% less")).toContain(15);
  });
  it("extracts Greek and English number words incl. compounds", () => {
    expect(extractNumbers("δώδεκα κιλά")).toContain(12);
    expect(extractNumbers("είκοσι πέντε τελάρα")).toContain(25);
    expect(extractNumbers("Δεκαπέντε τοις εκατό")).toContain(15);
    expect(extractNumbers("twenty-five boxes")).toContain(25);
    expect(extractNumbers("two hundred and fifty")).toContain(250);
    expect(extractNumbers("τρεις χιλιάδες")).toContain(3000);
  });
  it("numberInText ignores sign and accepts minor units in major", () => {
    expect(numberInText(-15, "15% φθηνότερα")).toBe(true);
    expect(numberInText(150000, "1.500 ευρώ", { minor: true })).toBe(true);
    expect(numberInText(150000, "1.500 ευρώ")).toBe(false);
    expect(numberInText(13, "δώδεκα κιλά")).toBe(false);
  });
  it("numbersNotInEvidence reports nested unsupported numbers", () => {
    const item = { lines: [{ product_text: "αλεύρι", quantity: 12 }, { product_text: "μαγιά", quantity: 3 }], requested_discount_pct: null };
    expect(numbersNotInEvidence(item, "δώδεκα κιλά αλεύρι και μαγιά")).toEqual(["/lines/1/quantity"]);
  });
  it("unknownNumbers finds numbers absent from the facts", () => {
    expect(unknownNumbers("Έχεις 3 επισκέψεις και 2 εργασίες, 40 ευρώ", ["3 visits", "δύο tasks"])).toEqual([40]);
  });
});

describe("enforceDebriefEvidence (planted hallucinations)", () => {
  it("keeps a fully grounded extraction unchanged", () => {
    const r = enforceDebriefEvidence(debriefOutput(), UTTERANCE);
    expect(r.dropped).toEqual([]);
    expect(r.output).toEqual(debriefOutput());
  });

  it("drops every planted item and asks about it; nulls invented numbers", () => {
    const o = debriefOutput();
    o.problems.push({ existing_problem_id: null, description: "Χαλασμένος φούρνος", status: "open", due_date: null, evidence: "ο φούρνος τους χάλασε" });
    o.tasks.push({ title: "Τηλεφώνησε", due_at: null, is_customer_promise: false, evidence: "να τον πάρω τηλέφωνο αύριο" });
    o.competitor_signals[0].price_delta_pct = -20; // utterance says 15%
    o.order_intent.lines[0].quantity = 15; // utterance says δώδεκα
    o.deal_update.amount_minor = 200000; // utterance says 1.500
    o.contacts.push({ existing_contact_id: null, full_name: "Μαρία", role_title: null, phone: "6900000000", email: null, is_decision_maker: null, evidence: "η Μαρία είναι η υπεύθυνη" });
    o.follow_up = { intent: "Στείλε τιμοκατάλογο", channel: "email", contact_name: "Γιώργος", evidence: "στείλε του τιμοκατάλογο" };
    const r = enforceDebriefEvidence(o, UTTERANCE);
    const planted = ["/problems/0", "/tasks/1", "/contacts/1", "/follow_up", "/competitor_signals/0/price_delta_pct", "/order_intent/lines/0/quantity", "/deal_update/amount_minor"];
    expect(r.dropped.map((d) => d.path).sort()).toEqual([...planted].sort()); // 7/7 = 100% dropped
    expect(r.output.problems).toEqual([]);
    expect(r.output.tasks.length).toBe(1);
    expect(r.output.contacts.map((c) => c.full_name)).toEqual(["Γιώργος"]);
    expect(r.output.follow_up.intent).toBe("");
    expect(r.output.competitor_signals[0].price_delta_pct).toBeNull();
    expect(r.output.order_intent.lines[0].quantity).toBeNull();
    expect(r.output.deal_update.amount_minor).toBeNull();
    expect(r.output.missing_fields.map((m) => m.field).sort()).toEqual([...planted].sort());
    expect(r.output.missing_fields.every((m) => m.question.length > 0)).toBe(true);
    expect(validateSchema(llmContracts.debrief_extraction.output, r.output, defSchemas)).toEqual([]);
  });

  it("empties a deal_update / order_intent whose evidence is invented", () => {
    const o = debriefOutput();
    o.deal_update.evidence = "κλείνουμε την επόμενη εβδομάδα";
    o.order_intent.evidence = "θέλει 30 σακιά";
    const r = enforceDebriefEvidence(o, UTTERANCE);
    expect(r.output.deal_update).toEqual({ evidence: "" });
    expect(r.output.order_intent.lines).toEqual([]);
    expect(validateSchema(llmContracts.debrief_extraction.output, r.output, defSchemas)).toEqual([]);
  });
});

describe("runtime safety (Functions sandbox lacks some String builtins)", () => {
  it("works with String.prototype.normalize and matchAll removed", () => {
    const proto = String.prototype as unknown as Record<string, unknown>;
    const saved = { normalize: proto.normalize, matchAll: proto.matchAll };
    delete proto.normalize; delete proto.matchAll;
    try {
      expect(normalizeText("Ο ΓΙΏΡΓΟΣ, Café!")).toBe("ο γιωργοσ cafe");
      expect(extractNumbers("δώδεκα κιλά, 1.500 ευρώ")).toEqual(expect.arrayContaining([12, 1500]));
      const r = enforceDebriefEvidence(debriefOutput(), UTTERANCE);
      expect(r.dropped).toEqual([]);
    } finally {
      Object.assign(proto, saved);
    }
  });
});
