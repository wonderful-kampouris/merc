// WP-CORE-02 hello world: one structured call through shared/llm on the dev
// merc-extract profile, then the code-side evidence check. Body (all optional):
// { utterance?: string, today?: "YYYY-MM-DD", profile?: string }
import { callStructured, enforceDebriefEvidence, type LlmInputMap } from "./_shared/llm/index";

const SAMPLE =
  "Ήμουν στον Φούρνο Παπαδόπουλου. Ο Γιώργος είπε ότι η Aroma τους έδωσε 15% φθηνότερα. " +
  "Βάλε κάτω δώδεκα κιλά αλεύρι τύπου 70. Θα του φέρω δείγματα την Πέμπτη.";

async function userFunction(context: FunctionContext): Promise<Result> {
  try {
    return await run(context);
  } catch (e) {
    return { ok: false, crash: e instanceof Error ? `${e.name}: ${e.message}` : String(e), stack: e instanceof Error ? String(e.stack ?? "").slice(0, 2000) : null };
  }
}

async function run(context: FunctionContext): Promise<Result> {
  const body = ((context as unknown as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>;
  const utterance = typeof body.utterance === "string" && body.utterance ? body.utterance : SAMPLE;
  const input = {
    utterance,
    language_hint: null,
    today: typeof body.today === "string" ? body.today : new Date().toISOString().slice(0, 10),
    account: { id: "11111111-1111-4111-8111-111111111111", name: "Φούρνος Παπαδόπουλου", account_type: "customer" },
    open_problems: [],
    open_deals: [],
    products: [{ product_id: "22222222-2222-4222-8222-222222222222", name: "Αλεύρι τύπου 70", unit: "kg", aliases: ["αλεύρι 70"] }],
    active_campaigns: [],
    contacts: [],
    competitors: ["Aroma"],
  } as unknown as LlmInputMap["debrief_extraction"];
  const t0 = Date.now();
  const r = await callStructured("debrief_extraction", input, { profile: typeof body.profile === "string" ? body.profile : undefined });
  if (!r.ok) return { ok: false, error: r.error, attempts: r.attempts, profile: r.profile, logs: r.logs, ms: Date.now() - t0 };
  const checked = enforceDebriefEvidence(r.value, utterance);
  return { ok: true, attempts: r.attempts, profile: r.profile, ms: Date.now() - t0, logs: r.logs, output: checked.output, dropped: checked.dropped };
}
