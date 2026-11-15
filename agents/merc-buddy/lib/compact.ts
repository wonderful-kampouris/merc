// What the model sees from a tool: only what it will say or pass to another tool (context hygiene).
// The functions and the app keep the full contract responses; this view exists only in the agent wrapper.
// Never drops: errors, spoken text, questions, missing fields, or any id another buddy tool accepts.

/** Ids some buddy tool takes as input (contracts/tools/merc-buddy/*.json). Everything else id-like is dropped. */
const USEFUL_IDS = new Set([
  "account_id", "ai_action_id", "alert_id", "approval_id", "candidate_id", "deal_id", "debrief_confirmation_id",
  "order_id", "plan_id", "product_id", "search_id", "task_id", "visit_id", "visit_brief_id", "voice_log_id",
  "contact_id", "problem_id",
]);
/** Internal or noisy fields the model never needs. */
const DROP = new Set([
  "lat", "lng", "processing_ms", "ms", "logs", "target_table", "target_id", "ref_table", "action_class",
  "distance_m", "briefing_id", "created_at", "updated_at", "retrieved_at", "source_url", "wonderful_conversation_id",
  "_metadata", "pending_recordings_hint", "postal_code", "format_version",
]);
/** Keep `id` only inside these objects (their id is what other tools take as account_id etc.). */
const ID_PARENTS = new Set(["account", "duplicate_of", "assigned_rep", "requested_by", "approver", "visit"]);

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

/** Generic pruning: no nulls/empties, no internal fields, no ids nobody can use. */
export function prune(v: unknown, parent = ""): unknown {
  if (Array.isArray(v)) return v.map((x) => prune(x, parent)).filter((x) => !isEmpty(x));
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (DROP.has(k)) continue;
    if (k === "id" && !ID_PARENTS.has(parent)) continue;
    if (k.endsWith("_id") && !USEFUL_IDS.has(k) && k !== "id") continue;
    const x = prune(raw, k);
    if (!isEmpty(x)) out[k] = x;
  }
  return out;
}

type Shaper = (r: any, ctx: { text: boolean }) => any;
const acct = (a: any) => (a ? { id: a.id, name: a.name, type: a.account_type, city: a.city ?? undefined } : undefined);

/** Per-tool views for the bulky results. Input is the inner result object (not {result}). */
const SHAPES: Record<string, Shaper> = {
  // Voice reads script_text; WhatsApp gets the laid-out script_text (chat-format.ts). Items are already in the script.
  get_briefing: (r) => ({ script_text: r.script_text, format: r.format, date: r.date }),
  get_today: (r) => {
    const seen = new Set<string>();
    const visits = (r.visits ?? [])
      .filter((v: any) => v.route_position != null || v.status === "planned") // ad-hoc re-logs of the same shop are noise
      .filter((v: any) => { const k = `${v.account?.id}:${v.route_position}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((v: any) => ({
        stop: v.route_position ?? undefined, visit_id: v.visit_id, account: acct(v.account), status: v.status,
        why: v.reason ?? v.purpose ?? undefined, at: v.planned_start_at ?? undefined,
      }));
    return { date: r.date, visits, ...(r.spoken_summary ? { spoken_summary: r.spoken_summary } : {}) };
  },
  log_visit: (r) => {
    const card = r.result ?? null;
    const lines = (card?.lines ?? []).filter((l: any) => l.undoable && l.status === "applied").map((l: any) => ({ ai_action_id: l.ai_action_id, summary: l.summary }));
    return {
      status: r.status, question: r.question, candidates: (r.candidates ?? []).map(acct),
      ...(card ? {
        voice_log_id: card.voice_log_id, account: acct(card.account), spoken_summary: card.spoken_summary,
        undoable: lines, missing_fields: card.missing_fields,
        pending_approvals: (card.pending_approvals ?? []).map((a: any) => ({ approval_id: a.approval_id, kind: a.kind, preview: a.preview, status: a.status })),
      } : {}),
    };
  },
  get_debrief_result: (r) => SHAPES.log_visit(r, { text: false }),
  resolve_account: (r) => (r.status === "resolved" ? { status: r.status, account: acct(r.account) } : { status: r.status, candidates: (r.candidates ?? []).map(acct), question: r.question }),
  call_me_back: (r) => ({ status: r.status, channel: r.channel, due_at: r.status === "scheduled" ? r.due_at : undefined }),
  undo_action: (r) => ({ status: r.status }),
};

/** The model's view of one tool result. Errors pass through unchanged. */
export function compactResult(tool: string, res: any, ctx: { text: boolean } = { text: false }): any {
  if (!res || typeof res !== "object") return res;
  if ("error" in res) return res;
  const wrapped = res.result && typeof res.result === "object" && !Array.isArray(res.result) && Object.keys(res).length === 1;
  const inner = wrapped ? res.result : res;
  if ("error" in inner) return res;
  const shaped = SHAPES[tool] ? SHAPES[tool](inner, ctx) : inner;
  const out = prune(shaped);
  return wrapped ? { result: out } : out;
}
