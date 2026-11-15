// merc-ops tool glue (WP-OPS-02, REQ-DSH-005). Contracts: spec/contracts/tools/merc-ops/*.json.
//   get_summary_data    -> the SAME fn:summary-data impl (bundled in ./ops.gen.js), run for the scope user's org.
//                          The facts are kept in the session KV so send_internal_email can check the email against them.
//   send_internal_email -> context.email, internal recipients only (active Merc managers/admins), and only numbers
//                          that appear in the facts fetched in this task (REQ-CORE-003 "numbers only from summary data").
//                          Global variable MERC_OPS_EMAIL_MODE: "send" sends; anything else (default) only logs a
//                          preview, so nothing is emailed until a human turns it on.
import { createDb, deliverRelayedWhatsApp, runForOps, unknownNumbers } from "./ops.gen.js";

export const FACTS_KEY = "merc_ops_facts";
export const MODE_GLOBAL = "MERC_OPS_EMAIL_MODE";
const ID_KEY = /(^id$|_id$|_ids$)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the merc-ops tools need from the Wonderful tool context (structural, so tests can fake it). */
export interface OpsCtx {
  tables: any;
  kv?: { get(key: string): any; set(key: string, value: any): any } | null;
  globals?: { get(name: string): unknown } | null;
  email?: { send(to: string, title: string, message: string | { text?: string; html?: string }): any } | null;
}

/** Leaf values of the facts that may legitimately appear in an email (ids excluded, so uuids allow no numbers). */
export function factSources(facts: unknown, out: string[] = [], key = ""): string[] {
  if (facts == null) return out;
  if (Array.isArray(facts)) { for (const x of facts) factSources(x, out, key); return out; }
  if (typeof facts === "object") { for (const [k, v] of Object.entries(facts as Record<string, unknown>)) factSources(v, out, k); return out; }
  if (ID_KEY.test(key)) return out;
  const s = String(facts);
  if (!UUID.test(s)) out.push(s);
  return out;
}

async function kvGet(ctx: OpsCtx, key: string): Promise<any> {
  try { return (await ctx.kv?.get(key)) ?? null; } catch { return null; }
}

export async function getSummaryData(ctx: OpsCtx, params: { kind: string; scope_user_id: string; from: string; to: string }) {
  const out = await runForOps(ctx.tables, params);
  if ("facts" in out) {
    const prev = (await kvGet(ctx, FACTS_KEY)) ?? [];
    try { await ctx.kv?.set(FACTS_KEY, [...(Array.isArray(prev) ? prev : []), out.facts].slice(-4)); } catch { /* kv unavailable: send check will refuse */ }
  }
  return out;
}

export async function sendInternalEmail(ctx: OpsCtx, params: { to: string; subject: string; body: string }) {
  const to = String(params.to ?? "").trim().toLowerCase();
  const subject = String(params.subject ?? "").trim();
  const body = String(params.body ?? "").trim();
  if (!to || !subject || !body) return { error: { code: "validation_failed", message: "to, subject and body are required" } };
  const users = await createDb(ctx.tables).app_user.all({ status: "active" });
  const recipient = users.find((u: any) => String(u.email ?? "").toLowerCase() === to && (u.role_code === "manager" || u.role_code === "admin"));
  if (!recipient) return { error: { code: "forbidden", message: `${to} is not an active Merc manager or admin; merc-ops only emails internal recipients` } };
  const facts = await kvGet(ctx, FACTS_KEY);
  if (!facts) return { error: { code: "invalid_state", message: "call get_summary_data first: every number in the email must come from its facts" } };
  const bad = unknownNumbers(`${subject}\n${body}`, factSources(facts));
  if (bad.length) return { error: { code: "validation_failed", message: `numbers not in the summary facts: ${bad.join(", ")}. Use only numbers from get_summary_data (no list numbering), then call again.`, details: { numbers: bad } } };
  let mode: unknown = null;
  try { mode = ctx.globals?.get(MODE_GLOBAL); } catch { mode = null; }
  if (mode !== "send") {
    return { sent: false, mode: "log", to, subject, preview: body.slice(0, 400), reason: `email sending is off: set global variable ${MODE_GLOBAL}="send" to deliver` };
  }
  if (!ctx.email) return { error: { code: "upstream_failed", message: "context.email is not available in this runtime" } };
  await ctx.email.send(to, subject, { text: body });
  return { sent: true, mode: "send", to, subject };
}

/**
 * deliver_whatsapp (contracts/tools/merc-ops/deliver_whatsapp.json): send relayed WhatsApp buddy_calls from this agent
 * runtime, where context.outbound exists. Functions (previsit brief, post-visit prompt, debrief confirmation) mark the
 * row relayed (channel whatsapp, status started) and fire the whatsapp_send webhook. The webhook body does not reach
 * TASK_CONTEXT.json, so without an id the tool sends every relayed row still waiting. The message is rebuilt by the
 * SAME buddy-call-start code, so the model never writes it. A sent row is never sent again (status guard).
 */
export const RELAY_BATCH = 20;
export async function deliverWhatsApp(ctx: any, params: { buddy_call_id?: string | null }) {
  const platform = { globals: ctx.globals ?? null, secrets: ctx.secrets ?? null } as any;
  const deps = { outbound: ctx.outbound ?? null };
  const id = String(params?.buddy_call_id ?? "").trim();
  if (id) {
    if (!UUID.test(id)) return { error: { code: "validation_failed", message: "buddy_call_id must be a uuid, or leave it out" } };
    return { waiting: 1, delivered: [await deliverRelayedWhatsApp(ctx.tables, platform, deps, id)] };
  }
  const waiting = (await createDb(ctx.tables).buddy_call.all({ channel: "whatsapp", status: "started" })).slice(0, RELAY_BATCH);
  const delivered = [];
  for (const row of waiting) delivered.push(await deliverRelayedWhatsApp(ctx.tables, platform, deps, row.id));
  return { waiting: waiting.length, delivered };
}
