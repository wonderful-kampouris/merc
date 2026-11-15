// WP-E2E-05: the J5 meeting loop as one script (SPEC J5, REQ-MTG-001..008, REQ-BUD-013/014, REQ-DEB-*, REQ-CRD-*).
// It runs the real shared handlers (the same impls the Functions and the merc-buddy tools run) on the seeded
// in-memory tables, on a fixed clock. Nothing leaves the process: WhatsApp and outbound calls are injected fakes,
// the LLM extraction is a fixed structured output, and the rep's taps on WhatsApp buttons are the buddy tool calls
// the meeting_loop skill makes for them (runAsTool with a signed Merc claim, exactly like the buddy).
//
//   const r = await runJ5({ mode: "simulated" });   // channels "live" against fakes: every send is captured
//   const r = await runJ5({ mode: "not_live" });    // dev today: no WhatsApp connection, no service account
import { runAsSystem, runAsTool, type Impl, type PlatformLike, type ToolContext, type UserPrincipal } from "../../../shared/core/src/index";
import { kit, ok, IDS, DEMO_DAY, type Kit } from "../../../shared/handlers/src/_lib/testkit";
import { makeImpl as previsitImpl } from "../../../shared/handlers/src/previsit-briefs-due";
import { makeImpl as postvisitImpl } from "../../../shared/handlers/src/postvisit-prompts-due";
import { makeImpl as confirmDueImpl } from "../../../shared/handlers/src/debrief-confirm-due";
import { makeImpl as confirmSendImpl, MAX_BULLETS } from "../../../shared/handlers/src/debrief-confirm-send";
import { makeImpl as briefImpl, MAX_SCRIPT_WORDS, type BriefDeps } from "../../../shared/handlers/src/visit-brief-get";
import { makeImpl as debriefImpl, type DebriefDeps } from "../../../shared/handlers/src/debrief-process";
import { makeImpl as feedbackImpl } from "../../../shared/handlers/src/feedback-record";
import { callMeBackTool, OUTBOUND_PATH, type BuddyDeps } from "../../../shared/handlers/src/buddy-call-start";
import { empty } from "../../../evals/debrief/j1";
import type { DebriefOutput } from "../../../shared/llm/src/index";

// ---- fixed clock (Europe/Athens is UTC+2 on the demo day) ---------------------------------------------------
/** Café Miltos is planned at 12:45 Athens on the demo day (seed). Every step time is derived from it. */
export const AT = {
  brief: "2026-11-16T10:15:00Z",          // 12:15: 30 min before -> WhatsApp brief
  briefRerun: "2026-11-16T10:20:00Z",     // cron again: nothing
  callMe: "2026-11-16T10:16:00Z",         // rep taps "Call me" on the brief
  postEarly: "2026-11-16T11:20:00Z",      // 13:20: visit end (13:15) + 10 min not reached
  post: "2026-11-16T11:25:00Z",           // 13:25: "How did it go at Café Miltos?"
  postRerun: "2026-11-16T11:30:00Z",
  debrief: "2026-11-16T11:27:00Z",        // rep taps "Call me", talks the debrief on the call
  confirmDue: "2026-11-16T11:28:00Z",     // debrief-confirm-due cron after the tool already sent it
  fix: "2026-11-16T11:40:00Z",            // rep taps "Fix" and says what was wrong
  notHelpful: "2026-11-16T11:41:00Z",     // rep taps "Brief did not help"
  nextBrief: "2026-11-23T10:15:00Z",      // next Monday, 30 min before the next Miltos visit
} as const;
export const NEXT_VISIT_START = "2026-11-23T10:45:00Z";
export const ms = (iso: string) => Date.parse(iso);

export const BUDDY_NUMBER = "+18455133803";
export const J5_DEBRIEF =
  "Ήμουν στο Café Miltos. Ο μύλος κάνει ακόμα θόρυβο, θα στείλουμε τεχνικό. " +
  "Υποσχέθηκα στον Μίλτο να του φέρω δείγματα Espresso Nuovo την Πέμπτη. " +
  "Βάλε μια παραγγελία για τα συνηθισμένα δώδεκα κιλά Espresso Classico.";
export const J5_FIX = "Ήταν 10 κιλά, όχι 12.";
export const PROBLEM = "e5198444-d143-5b8d-a174-70391f0aa839"; // seed: Café Miltos grinder problem

export type Mode = "simulated" | "not_live";
export interface J5Options {
  mode: Mode;
  /** false = the control run: the rep never taps "Brief did not help". */
  briefNotHelpful?: boolean;
  clock: { set(iso: string): void };
}

// ---- fakes --------------------------------------------------------------------------------------------------
export interface Sent { channel: "whatsapp" | "call"; kind: string; to: string; template?: string; text?: string; params?: string[]; purpose?: string; buttons?: string[] }
export function fakeChannels() {
  const sent: Sent[] = [];
  const pushes: Array<{ channel: string; type: string }> = [];
  return {
    sent, pushes,
    outbound: {
      whatsapp: {
        sendTemplate: async (o: any) => { sent.push({ channel: "whatsapp", kind: "template", to: o.destination, template: o.templateName, params: o.templateParams }); },
        sendInteractive: async (o: any) => { sent.push({ channel: "whatsapp", kind: "interactive", to: o.destination, text: o.message, buttons: o.interaction.buttons.map((b: any) => b.title) }); },
      },
    },
    api: {
      post: async (path: string, o?: { body?: any }) => {
        if (path === OUTBOUND_PATH) { sent.push({ channel: "call", kind: "outbound", to: o?.body?.to, purpose: o?.body?.call_purpose }); return { id: `conv-${sent.length}` }; }
        pushes.push({ channel: o?.body?.channel, type: o?.body?.data?.type });
        return {};
      },
    },
  };
}

const extraction = (out: DebriefOutput): DebriefDeps["extract"] => async () => ({ ok: true, value: out, attempts: 1, profile: "fake-merc-extract", logs: [] });

/** The model output for J5_DEBRIEF (grounded by debrief-process: every quote is in the utterance). */
export function debriefOutput(classico: string, kg: number, orderEvidence: string): DebriefOutput {
  return {
    ...empty(),
    note: "Επίσκεψη στο Café Miltos: ο μύλος κάνει θόρυβο, δείγματα Espresso Nuovo την Πέμπτη.",
    problems: [{ existing_problem_id: PROBLEM, description: "Grinder is making noise", status: "in_progress", due_date: null, evidence: "Ο μύλος κάνει ακόμα θόρυβο" }],
    tasks: [{ title: "Δείγματα Espresso Nuovo στον Μίλτο", due_at: "2026-11-19T09:00:00+02:00", is_customer_promise: true, evidence: "να του φέρω δείγματα Espresso Nuovo την Πέμπτη" }],
    order_intent: { lines: [{ product_id: classico, product_text: "Espresso Classico", quantity: kg, unit: "kg" }], requested_discount_pct: null, evidence: orderEvidence },
  } as DebriefOutput;
}

const noModelBrief = (now: () => number): BriefDeps => ({
  bullets: async () => ({ ok: false, error: { code: "upstream_failed", message: "no model in the e2e run: code wording" } as any, attempts: 1, profile: "none", logs: [] }),
  kb: async () => [], now, log: () => {},
});

// ---- the run ------------------------------------------------------------------------------------------------
export interface J5Result { t: Kit; steps: Record<string, unknown>; sent: Sent[]; pushes: Array<{ channel: string; type: string }>; repPhone: string }

export async function runJ5(o: J5Options): Promise<J5Result> {
  const live = o.mode === "simulated";
  const globals: Record<string, unknown> = live
    ? { MERC_CHANNELS_LIVE: true, MERC_WHATSAPP_CONNECTION: "merc-wa-e2e", MERC_BUDDY_NUMBER: BUDDY_NUMBER }
    : { MERC_CHANNELS_LIVE: true, MERC_BUDDY_NUMBER: BUDDY_NUMBER }; // dev today: MERC_WHATSAPP_CONNECTION absent
  const t = kit({ globals });
  const ch = fakeChannels();
  let nowMs = 0;
  const now = () => nowMs;
  const at = (iso: string) => { o.clock.set(iso); nowMs = ms(iso); };
  const buddy: BuddyDeps = live ? { now, outbound: ch.outbound, api: ch.api, log: () => {} } : { now, log: () => {} };
  const platform = t.platform as PlatformLike;
  const steps: Record<string, unknown> = {};
  const nikos = (await t.db.app_user.require(IDS.nikos));
  const classico = (await t.db.product.findOne({ sku: "ESP-CL-1" }))!.id;
  const visit = (await t.db.visit.all({ account_id: IDS.miltos, planned_date: DEMO_DAY, status: "planned" }))[0]!;

  const cron = <S extends "previsit-briefs-due" | "postvisit-prompts-due" | "debrief-confirm-due">(slug: S, impl: Impl<S, any>) =>
    runAsSystem(slug, impl, { tables: t.tables, data: {}, orgId: IDS.org, platform }).then(ok);
  /** The buddy's tool runtime: a signed Merc claim for Nikos (a WhatsApp/phone session resolves to the same user). */
  const toolCtx = (): ToolContext & { api?: unknown; outbound?: unknown } =>
    Object.assign(t.toolCtx("nikos", { now: nowMs }), live ? { api: ch.api, outbound: ch.outbound } : {});
  const tool = <S extends Parameters<typeof runAsTool>[0]>(slug: S, impl: Impl<S, UserPrincipal>, params: unknown) =>
    runAsTool(slug, impl as never, toolCtx(), params, t.key).then(ok) as Promise<any>;
  const brief = () => briefImpl(noModelBrief(now)) as Impl<"visit-brief-get", UserPrincipal>;
  const debrief = (out: DebriefOutput) => debriefImpl({ extract: extraction(out), now, log: () => {} });
  const feedback = feedbackImpl({ now });
  const confirmSend = confirmSendImpl(buddy) as Impl<"debrief-confirm-send", UserPrincipal>;

  // 1. 30 min before: one brief, delivered once (REQ-MTG-001/002/003).
  at(AT.brief);
  steps.previsit = await cron("previsit-briefs-due", previsitImpl({ buddy, brief: noModelBrief(now) }));
  at(AT.briefRerun);
  steps.previsitRerun = await cron("previsit-briefs-due", previsitImpl({ buddy, brief: noModelBrief(now) }));
  const brief1 = (await t.db.visit_brief.findOne({ visit_id: visit.id }))!;
  steps.brief1 = brief1;
  steps.brief1Call = await t.db.buddy_call.get(brief1.buddy_call_id!);

  // 2. "Call me" on the WhatsApp brief: one outbound call to his own number; on the call the buddy reads the script.
  at(AT.callMe);
  steps.callMe = await callMeBackTool(toolCtx() as never, { purpose: "pre_visit", channel: "call" }, t.key, buddy).then(ok);
  steps.readBrief = await tool("visit-brief-get", brief(), { visit_id: visit.id });

  // 3. After the visit: exactly one "How did it go at Café Miltos?" (REQ-MTG-005).
  at(AT.postEarly);
  steps.postEarly = await cron("postvisit-prompts-due", postvisitImpl(buddy));
  at(AT.post);
  steps.post = await cron("postvisit-prompts-due", postvisitImpl(buddy));
  steps.postCall = (await t.db.buddy_call.all({ user_id: IDS.nikos, purpose: "post_visit" }))[0] ?? null;
  at(AT.postRerun);
  steps.postRerun = await cron("postvisit-prompts-due", postvisitImpl(buddy));

  // 4. He answers ("Call me" on the prompt), talks the debrief; log_visit, then send_debrief_confirmation (REQ-MTG-006).
  at(AT.debrief);
  steps.callBack = await callMeBackTool(toolCtx() as never, { purpose: "post_visit", channel: "call" }, t.key, buddy).then(ok);
  const d1 = await tool("debrief-process", debrief(debriefOutput(classico, 12, "παραγγελία για τα συνηθισμένα δώδεκα κιλά Espresso Classico")),
    { utterance: J5_DEBRIEF, conversation_id: "conv-j5-debrief", language: "el" });
  steps.debrief = d1;
  steps.confirm = await tool("debrief-confirm-send", confirmSend, { voice_log_id: d1.result.voice_log_id });
  at(AT.confirmDue);
  steps.confirmDue = await cron("debrief-confirm-due", confirmDueImpl(buddy));
  const dc = (await t.db.debrief_confirmation.findOne({ voice_log_id: d1.result.voice_log_id }))!;
  steps.confirmationRow = dc;

  // 5. "Fix": "it was 10 kg, not 12" -> undo + re-log through corrects_voice_log_id, then debrief_corrected (REQ-MTG-007).
  at(AT.fix);
  const d2 = await tool("debrief-process", debrief(debriefOutput(classico, 10, J5_FIX)),
    { utterance: J5_FIX, corrects_voice_log_id: d1.result.voice_log_id, conversation_id: "conv-j5-fix", language: "el" });
  steps.fixDebrief = d2;
  steps.fixFeedback = await tool("feedback-record", feedback, { kind: "debrief_corrected", debrief_confirmation_id: dc.id, detail: J5_FIX, correction_voice_log_id: d2.result.voice_log_id });

  // 6. "Brief did not help" (REQ-MTG-008).
  at(AT.notHelpful);
  if (o.briefNotHelpful !== false) steps.notHelpful = await tool("feedback-record", feedback, { kind: "brief_not_useful", debrief_confirmation_id: dc.id });

  // 7. The next Miltos visit (a week later): its brief is built by the same cron.
  const next = await t.db.visit.insert({
    rep_id: IDS.nikos, account_id: IDS.miltos, planned_date: "2026-11-23", planned_start_at: NEXT_VISIT_START,
    planned_duration_min: 30, status: "planned", purpose: visit.purpose ?? null, origin: visit.origin,
  } as any);
  at(AT.nextBrief);
  steps.nextPrevisit = await cron("previsit-briefs-due", previsitImpl({ buddy, brief: noModelBrief(now) }));
  steps.brief2 = await t.db.visit_brief.findOne({ visit_id: next.id });
  return { t, steps, sent: ch.sent, pushes: ch.pushes, repPhone: nikos.phone! };
}

export { MAX_BULLETS, MAX_SCRIPT_WORDS, IDS };
