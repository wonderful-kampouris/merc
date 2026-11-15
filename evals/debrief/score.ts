// Scoring for the debrief golden set (evals/debrief/golden.json). Pure: used by the offline test in
// shared/handlers/test/debrief-process.test.ts and by the dev run (run-dev.ts).
//   facts  = what debrief-process applied, rebuilt from its ai_action rows (payload_json)
//   checks = field-level expectations per case (REQ-NFR-004: >= 90% Greek, WP: >= 80% overall)
//   invented numbers = numbers in the applied facts that the utterance never said (REQ-CORE-003: must be 0)
import { numberInText } from "../../shared/llm/src/evidence";

export interface Check { f: string; op: "eq" | "len" | "has" | "null" | "not_null"; v?: unknown }
export interface GoldenCase { id: string; lang: "el" | "en" | "mixed"; tags: string[]; account: string | null; utterance: string; checks: Check[] }
export interface Golden { account_keys: Record<string, string>; ids: Record<string, string>; default_plants: Array<{ path: string; item: Record<string, unknown> }>; cases: GoldenCase[] }

export interface Facts {
  status: string; question: string | null;
  tasks: Array<{ title: string; due_date: string | null; is_customer_promise: boolean }>;
  problems: Array<{ id: string | null; status: string }>;
  deal: { stage_code: string | null; amount_minor: number | null };
  signals: Array<{ competitor_id: string; delta: number | null }>;
  pitched: string[];
  order_lines: Array<{ product_id: string; quantity: number }>;
  approvals: Array<{ channel: string }>;
  contacts: Array<{ full_name: string; phone: string | null }>;
}
export interface ActionRow { action_type_code: string; status: string; payload_json: string | null }

const parse = (s: string | null): any => { try { return JSON.parse(s ?? "null") ?? {}; } catch { return {}; } };

/** Facts from a debrief-process response + the ai_action rows of its voice log. `localDate` maps an instant to the org date. */
export function factsFrom(res: { status: string; question?: string | null }, actions: ActionRow[], localDate: (iso: string) => string): Facts {
  const f: Facts = { status: res.status, question: res.question ?? null, tasks: [], problems: [], deal: { stage_code: null, amount_minor: null }, signals: [], pitched: [], order_lines: [], approvals: [], contacts: [] };
  for (const a of actions) {
    const p = parse(a.payload_json);
    const applied = a.status === "applied";
    switch (a.action_type_code) {
      case "create_task": if (applied) f.tasks.push({ title: p.title, due_date: p.due_at ? localDate(p.due_at) : null, is_customer_promise: !!p.is_customer_promise }); break;
      case "update_problem": if (applied) f.problems.push({ id: p.existing_problem_id ?? null, status: p.patch?.status ?? p.status }); break;
      case "create_problem": if (applied) f.problems.push({ id: null, status: p.status }); break;
      case "update_deal": if (applied) f.deal = { stage_code: p.patch?.stage_code ?? null, amount_minor: p.patch?.amount_minor ?? null }; break;
      case "create_deal": if (applied) f.deal = { stage_code: p.stage_code ?? "new", amount_minor: p.amount_minor ?? null }; break;
      case "create_competitor_signal": if (applied) f.signals.push({ competitor_id: p.competitor_id, delta: p.price_delta_pct ?? null }); break;
      case "log_campaign_pitch": if (applied) f.pitched.push(p.campaign_id); break;
      case "create_draft_order": if (applied) for (const l of p.lines ?? []) if (l.product_id && typeof l.quantity === "number") f.order_lines.push({ product_id: l.product_id, quantity: l.quantity }); break;
      case "create_contact": case "update_contact": if (applied) f.contacts.push({ full_name: p.full_name, phone: p.patch?.phone ?? p.phone ?? null }); break;
      case "send_email": case "send_whatsapp": case "send_viber": f.approvals.push({ channel: p.follow_up?.channel ?? a.action_type_code.replace("send_", "") }); break;
    }
  }
  return f;
}

const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), o);
const isoWeekday = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const daysFrom = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function matchItem(f: string, item: any, want: any, g: Golden, today: string): boolean {
  const id = (k: string) => g.ids[k] ?? k;
  switch (f) {
    case "tasks": return (want.is_customer_promise === undefined || item.is_customer_promise === want.is_customer_promise)
      && (want.weekday === undefined || (!!item.due_date && isoWeekday(item.due_date) === want.weekday && daysFrom(today, item.due_date) >= 1 && daysFrom(today, item.due_date) <= 7))
      && (want.days_from_today === undefined || (!!item.due_date && daysFrom(today, item.due_date) === want.days_from_today));
    case "problems": return (want.id === undefined || item.id === id(want.id)) && (want.status === undefined || item.status === want.status);
    case "signals": return item.competitor_id === id(want.competitor) && (want.delta === undefined || item.delta === want.delta);
    case "pitched": return item === id(want);
    case "order_lines": return item.product_id === id(want.product) && (want.quantity === undefined || item.quantity === want.quantity);
    case "approvals": return item.channel === want.channel;
    case "contacts": return (!want.name_contains || String(item.full_name).includes(want.name_contains)) && (want.phone === undefined || item.phone === want.phone);
    default: return JSON.stringify(item) === JSON.stringify(want);
  }
}

export interface CheckResult { check: Check; pass: boolean; got: unknown }
export function runChecks(c: GoldenCase, facts: Facts, g: Golden, today: string): CheckResult[] {
  return c.checks.map((ch) => {
    const got = get(facts, ch.f);
    let pass = false;
    switch (ch.op) {
      case "eq": pass = got === ch.v; break;
      case "null": pass = got === null || got === undefined; break;
      case "not_null": pass = got !== null && got !== undefined && got !== ""; break;
      case "len": pass = Array.isArray(got) && got.length === ch.v; break;
      case "has": pass = Array.isArray(got) && got.some((x) => matchItem(ch.f, x, ch.v, g, today)); break;
    }
    return { check: ch, pass, got };
  });
}

/** Numbers stored as fact that the utterance never said (Rule A). Dates are checked by the date grounding, not here. */
export function inventedNumbers(utterance: string, f: Facts): Array<{ field: string; value: number }> {
  const out: Array<{ field: string; value: number }> = [];
  const chk = (field: string, v: number | null | undefined, minor = false) => { if (typeof v === "number" && !numberInText(v, utterance, { minor })) out.push({ field, value: v }); };
  chk("deal.amount_minor", f.deal.amount_minor, true);
  f.signals.forEach((s, i) => chk(`signals.${i}.delta`, s.delta));
  f.order_lines.forEach((l, i) => chk(`order_lines.${i}.quantity`, l.quantity));
  return out;
}

export interface Summary { cases: number; checks: number; passed: number; field_level_pct: number; greek_field_level_pct: number; invented_numbers: number; cases_with_invented_numbers: number; p95_ms: number | null; latencies_ms: number[] }
export const p95 = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!; };
export function summarize(rows: Array<{ c: GoldenCase; results: CheckResult[]; invented: unknown[]; ms?: number | null }>): Summary {
  const all = rows.flatMap((r) => r.results), el = rows.filter((r) => r.c.lang === "el").flatMap((r) => r.results);
  const pct = (xs: CheckResult[]) => (xs.length ? Math.round((1000 * xs.filter((x) => x.pass).length) / xs.length) / 10 : 0);
  const lat = rows.map((r) => r.ms).filter((x): x is number => typeof x === "number");
  return { cases: rows.length, checks: all.length, passed: all.filter((x) => x.pass).length, field_level_pct: pct(all), greek_field_level_pct: pct(el), invented_numbers: rows.reduce((n, r) => n + r.invented.length, 0), cases_with_invented_numbers: rows.filter((r) => r.invented.length).length, p95_ms: p95(lat), latencies_ms: lat };
}
