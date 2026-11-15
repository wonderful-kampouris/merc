// Code re-validation of a debrief_extraction output (REQ-DEB-004, REQ-CORE-003):
// items whose evidence is not in the utterance are dropped and asked about;
// numbers missing from an item's evidence are nulled and asked about.
import type { LlmOutputMap } from "./contracts.js";
import { evidenceInUtterance, numbersNotInEvidence } from "./evidence.js";

export type DebriefOutput = LlmOutputMap["debrief_extraction"];
export interface Dropped { path: string; reason: "evidence_not_in_utterance" | "number_not_in_evidence"; evidence: string }
export interface EnforceResult { output: DebriefOutput; dropped: Dropped[] }

type Lang = "el" | "en";
const Q = {
  confirm: { en: (w: string) => `Could you confirm "${w}"? I could not match it to what you said.`, el: (w: string) => `Μπορείς να επιβεβαιώσεις «${w}»; Δεν το βρήκα σε όσα είπες.` },
  number: { en: (f: string) => `What is the exact ${f}?`, el: (f: string) => `Ποιο είναι ακριβώς το ${f};` },
};

const ARRAYS = ["problems", "tasks", "competitor_signals", "contacts", "campaigns_pitched"] as const;
const label = (o: Record<string, unknown>): string =>
  String(o.description ?? o.title ?? o.statement ?? o.full_name ?? o.intent ?? o.new_deal_title ?? o.next_step ?? o.campaign_id ?? "this item");

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split("/").filter(Boolean);
  let cur: Record<string, unknown> = root;
  for (const p of parts.slice(0, -1)) cur = cur[p] as Record<string, unknown>;
  cur[parts[parts.length - 1]] = value;
}

/** Non-null content besides evidence (an "empty" deal_update/follow_up is not checked). */
const hasContent = (o: Record<string, unknown>) =>
  Object.entries(o).some(([k, v]) => k !== "evidence" && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0));

export function enforceDebriefEvidence(output: DebriefOutput, utterance: string): EnforceResult {
  const out = JSON.parse(JSON.stringify(output)) as DebriefOutput & Record<string, unknown>;
  const lang: Lang = out.language === "el" ? "el" : "en";
  const dropped: Dropped[] = [];
  const ask = (field: string, question: string) => { if (!out.missing_fields.some((m) => m.field === field)) out.missing_fields.push({ field, question }); };

  // Returns false when the whole item must go; otherwise nulls unsupported numbers in place.
  const check = (item: Record<string, unknown>, path: string): boolean => {
    const ev = String(item.evidence ?? "");
    if (!evidenceInUtterance(ev, utterance)) {
      dropped.push({ path, reason: "evidence_not_in_utterance", evidence: ev });
      ask(path, Q.confirm[lang](label(item)));
      return false;
    }
    for (const p of numbersNotInEvidence(item, ev)) {
      dropped.push({ path: `${path}${p}`, reason: "number_not_in_evidence", evidence: ev });
      setPath(item, p, null);
      ask(`${path}${p}`, Q.number[lang](p.split("/").filter((x) => !/^\d+$/.test(x)).join(" ").replace(/_/g, " ")));
    }
    return true;
  };

  for (const key of ARRAYS) {
    const list = out[key] as unknown as Record<string, unknown>[];
    (out as Record<string, unknown>)[key] = list.filter((item, i) => check(item, `/${key}/${i}`));
  }
  const deal = out.deal_update as unknown as Record<string, unknown>;
  if (hasContent(deal) && !check(deal, "/deal_update")) out.deal_update = { evidence: "" } as DebriefOutput["deal_update"];
  const order = out.order_intent as unknown as Record<string, unknown>;
  if (hasContent(order) && !check(order, "/order_intent")) out.order_intent = { lines: [], requested_discount_pct: null, evidence: "" };
  const fu = out.follow_up as unknown as Record<string, unknown>;
  if (String(fu.intent ?? "") !== "" && !check(fu, "/follow_up")) out.follow_up = { ...out.follow_up, intent: "", contact_name: null, evidence: "" };
  return { output: out, dropped };
}
