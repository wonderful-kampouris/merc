// fn:debrief-confirm-send (contracts/functions/debrief-confirm-send.json, REQ-MTG-006).
// After a debrief completes, send the rep a short summary of what Merc logged, to confirm or fix.
// - Bullets are built in code from the voice log's result card (applied/suggested actions + pending approvals). No LLM.
// - One confirmation per voice log (idempotent on voice_log_id).
// - WhatsApp when the rep has it (own number + Merc WhatsApp connection), through buddy-call-start purpose
//   debrief_confirm (template merc_debrief_confirm, or interactive inside the 24 h window). If WhatsApp cannot be
//   sent (channels not live, no outbound sender in this runtime), it falls back to the app: the result card is
//   already there and merc-live pushes debrief_confirmation.status. The failed buddy_call row keeps the reason.
import { assertOwner, invalid, type Db, type Impl, type PlatformLike, type Principal, type Row, type UserPrincipal } from "../../core/src/index";
import { push, repChannel } from "../../live/src/index";
import { cardFromRows } from "./debrief-process";
import { defineWithDeps, hasWhatsApp, isoAt, langOf, logOf, nowOf, requestBuddyCall, type BuddyDeps } from "./buddy-call-start";

export const MAX_BULLETS = 6;
type Card = Awaited<ReturnType<typeof cardFromRows>>;
type Lang = "el" | "en";

/** At most 6 bullets from the result card; overflow becomes one "+N more in the app" bullet (N counted in code). */
export function summaryBullets(card: Pick<Card, "lines" | "pending_approvals">, lang: Lang): string[] {
  const lines = card.lines.filter((l) => l.status === "applied" || l.status === "suggested").map((l) => `• ${l.summary}`);
  const waiting = lang === "en" ? "Waiting for your OK" : "Περιμένει το OK σου";
  const pending = card.pending_approvals.map((a) => `• ${waiting}: ${a.preview}`);
  const all = [...lines, ...pending];
  if (!all.length) return [lang === "en" ? "• Nothing to change was logged" : "• Δεν καταγράφηκε κάποια αλλαγή"];
  if (all.length <= MAX_BULLETS) return all;
  const more = all.length - (MAX_BULLETS - 1);
  return [...all.slice(0, MAX_BULLETS - 1), lang === "en" ? `• +${more} more in the app` : `• +${more} ακόμη στην εφαρμογή`];
}

export function summaryText(accountName: string, bullets: string[], lang: Lang): string {
  const head = lang === "en" ? `${accountName}: what I logged` : `${accountName}: τι κατέγραψα`;
  return [head, ...bullets].join("\n");
}

/** Create (or return) the confirmation for one completed voice log and deliver it. Used by the function, the tool and the cron. */
export async function sendConfirmation(db: Db, platform: PlatformLike, deps: BuddyDeps, vl: Row<"voice_log">, user: Row<"app_user">, org: Row<"organization">, channel: "whatsapp" | "app" | null = null): Promise<Row<"debrief_confirmation">> {
  const existing = await db.debrief_confirmation.findOne({ voice_log_id: vl.id });
  if (existing) return existing;
  if (vl.status !== "completed") throw invalid(`voice log is ${vl.status}; only a completed debrief can be confirmed`, { voice_log_id: vl.id, status: vl.status });
  const card = await cardFromRows(db, vl);
  const lang: Lang = langOf(user, org);
  const summary = summaryText(card.account.name, summaryBullets(card, lang), lang);
  const now = nowOf(deps);
  const want = channel ?? (hasWhatsApp(user, platform) ? "whatsapp" : "app");
  let row = await db.debrief_confirmation.insert({ voice_log_id: vl.id, rep_id: vl.rep_id, visit_id: vl.visit_id ?? null, channel: want, summary_text: summary, status: "pending" });
  if (want === "whatsapp") {
    const out = await requestBuddyCall(db, platform, deps, user, org, { channel: "whatsapp", purpose: "debrief_confirm", ref_table: "debrief_confirmation", ref_id: row.id });
    row = out.status === "sent"
      ? await db.debrief_confirmation.update(row.id, { buddy_call_id: out.row.id, status: "sent", sent_at: isoAt(now) })
      : await db.debrief_confirmation.update(row.id, { buddy_call_id: out.row.id, channel: "app", status: "sent", sent_at: isoAt(now) });
  } else {
    row = await db.debrief_confirmation.update(row.id, { status: "sent", sent_at: isoAt(now) });
  }
  await push(deps, "debrief_confirmation.status", { debrief_confirmation_id: row.id, voice_log_id: vl.id, status: row.status }, repChannel(vl.rep_id), { now: deps.now, log: logOf(deps) });
  return row;
}

export function makeImpl(deps: BuddyDeps = {}): Impl<"debrief-confirm-send", Principal> {
  return async ({ req, db, me, platform }) => {
    const vl = await db.voice_log.require(req.voice_log_id);
    assertOwner(me, vl.rep_id, "voice log");
    const user = await db.app_user.require(vl.rep_id);
    const row = await sendConfirmation(db, platform, deps, vl, user, me.org, req.channel ?? null);
    return { debrief_confirmation_id: row.id, status: row.status, summary_text: row.summary_text };
  };
}

export const impl = makeImpl() as Impl<"debrief-confirm-send", UserPrincipal>;
export const handle = defineWithDeps("debrief-confirm-send", makeImpl);
