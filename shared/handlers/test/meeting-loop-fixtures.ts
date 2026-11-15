// Shared fixtures for the meeting-loop handler tests (REQ-MTG-*). Not a test file itself.
import { expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_DAY, IDS, type kit } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import type { BriefDeps } from "../src/visit-brief-get";

export type Kit = ReturnType<typeof kit>;
export const BUDDY = "+18455133803";
export const NIKOS_PHONE = "+306900000003";
export const WA = { MERC_WHATSAPP_CONNECTION: "merc-wa-test", MERC_BUDDY_NUMBER: BUDDY };
export const LIVE = { ...WA, MERC_CHANNELS_LIVE: true };
export const iso = (ms: number) => new Date(ms).toISOString();

export async function miltosVisit(t: Kit) {
  const v = (await t.db.visit.all({ account_id: IDS.miltos, planned_date: DEMO_DAY, status: "planned" }))[0];
  expect(v?.planned_start_at).toBeTruthy();
  return v!;
}

export function fakeOutbound() {
  const sent: any[] = [];
  return {
    sent,
    whatsapp: {
      sendTemplate: async (o: any) => { sent.push({ kind: "template", ...o }); },
      sendInteractive: async (o: any) => { sent.push({ kind: "interactive", ...o }); },
    },
  };
}

export function fakeApi() {
  const calls: Array<{ path: string; body: any }> = [];
  return { calls, post: async (path: string, o?: { body?: unknown }) => { calls.push({ path, body: o?.body }); return { id: `comm-${calls.length}` }; } };
}

/** Brief deps without a model: the brief falls back to code wording (push/avoid still chosen in code). */
export const noLlmBrief = (now: number): BriefDeps => ({
  bullets: async () => ({ ok: false, error: { code: "upstream_failed", message: "no model in tests" } as any, attempts: 1, profile: "p", logs: [] }),
  kb: async () => [],
  now: () => now,
  log: () => {},
});

/** A completed debrief for Café Miltos with two applied internal actions. */
export async function completedLog(t: Kit, processedAt: number) {
  const v = await miltosVisit(t);
  const codes = (await t.db.action_type.all()).filter((a) => a.action_class === "internal").map((a) => a.code);
  const vl = await t.db.voice_log.insert({
    rep_id: IDS.nikos, account_id: IDS.miltos, visit_id: v.id, capture_mode: "live_buddy", transcript: "Ο Μίλτος θέλει δείγματα την Πέμπτη.",
    status: "completed", idempotency_key: `k-${processedAt}-${Math.random()}`, recorded_at: iso(processedAt - 60_000), processed_at: iso(processedAt),
  } as any);
  for (const [i, reason] of ["Task: bring samples on Thursday", "Grinder problem: technician on Friday"].entries()) {
    await t.db.ai_action.insert({
      org_id: IDS.org, on_behalf_of: IDS.nikos, agent: "debrief", action_type_code: codes[i]!, voice_log_id: vl.id,
      status: "applied", reason, applied_at: iso(processedAt),
    } as any);
  }
  return { vl, visit: v };
}

export async function expectFreshBundle(slug: string) {
  const committed = readFileSync(join(FUNCTIONS, slug, "handler.gen.js"), "utf8");
  expect(committed === (await bundleText(slug))).toBe(true);
  expect(committed).not.toMatch(/from\s*["']node:/);
}
