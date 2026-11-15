import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@wonderful/ui-base", () => import("./uiStub"));
vi.mock("@wonderful/app-sdk", () => ({ useWonderful: () => ({ context: { apiBaseUrl: "https://default.api.x.sb.wonderful.ai" }, api: {} }) }));

import { callMock } from "../../../contracts";
import { createClient } from "../../../lib/client";
import { I18nProvider, type Lang } from "../../../lib/i18n";
import { SCREENS } from "../../../lib/routes";
import BuddyVoice from "./BuddyVoice";
import Record from "./index";
import QueueList from "./QueueList";
import { createItem } from "./queue";
import ResultCardView from "./ResultCardView";
import type { ResultCard } from "./resultCard";

const screen = SCREENS.find((s) => s.route === "/rep/record")!;
const wrap = (lang: Lang, node: ReturnType<typeof h>) => renderToStaticMarkup(h(I18nProvider, { lang, children: node }));
const card = (): ResultCard => {
  const r = callMock("debrief-result-get", { voice_log_id: "00000000-0000-4000-8000-000000000001" });
  if ("error" in r) throw new Error("mock");
  return {
    ...(r.result as ResultCard),
    spoken_summary: "Σημείωσα το πρόβλημα με τον μύλο.",
    lines: [
      { ai_action_id: "00000000-0000-4000-8000-0000000000a1", action_type: "note_create", action_class: "internal", status: "applied", summary: "Note: grinder fixed", undoable: true },
      { ai_action_id: "00000000-0000-4000-8000-0000000000a2", action_type: "task_create", action_class: "internal", status: "undone", summary: "Task: bring samples", undoable: false },
    ],
  };
};

describe("Record screen components", () => {
  it("result card shows summary, actions with undo, missing fields, approvals (el default)", () => {
    const html = wrap("el", h(ResultCardView, { card: card(), onUndo: () => undefined }));
    expect(html).toContain("Η επίσκεψη καταχωρήθηκε");
    expect(html).toContain("Σημείωσα το πρόβλημα με τον μύλο.");
    expect(html).toContain("Note: grinder fixed");
    expect(html.match(/data-clickable="true"[^>]*>Αναίρεση</g)?.length ?? html.split(">Αναίρεση<").length - 1).toBe(1); // only the applied+undoable line
    expect(html).toContain("Αναιρέθηκε");
    expect(html).toContain("Στοιχεία που λείπουν");
    expect(html).toContain("Σε αναμονή έγκρισης");
  });

  it("result card in English", () => {
    const html = wrap("en", h(ResultCardView, { card: card(), onUndo: () => undefined }));
    expect(html).toContain("Visit logged");
    expect(html).toContain(">Undo<");
  });

  it("queue: empty state and queued/failed rows", () => {
    expect(wrap("en", h(QueueList, { items: [], online: true, pending: 0, syncing: false, lang: "en", onSync() {}, onRetry() {}, onRemove() {}, onView() {} }))).toContain("No recordings yet");
    const q = createItem({ transcript: "At Miltos", key: "k1" });
    const f = { ...createItem({ transcript: "x", key: "k2" }), status: "failed" as const, error: "validation_failed: bad" };
    const html = wrap("el", h(QueueList, { items: [q, f], online: false, pending: 1, syncing: false, lang: "el", onSync() {}, onRetry() {}, onRemove() {}, onView() {} }));
    expect(html).toContain("Σε αναμονή αποστολής");
    expect(html).toContain("Χωρίς σύνδεση");
    expect(html).toContain("validation_failed: bad");
    expect(html).toContain("Ξανά");
  });

  it("buddy degrades with a clear message when the token function is not listed, or in mock mode", () => {
    expect(wrap("en", h(BuddyVoice, { source: { ok: false, reason: "not_listed" }, online: true, lang: "en" }))).toContain("merc-chat-token is missing");
    expect(wrap("en", h(BuddyVoice, { source: { ok: false, reason: "mock" }, online: true, lang: "en" }))).toContain("off in mock mode");
    const ok = wrap("en", h(BuddyVoice, { source: { ok: true, fetch: async () => ({ token: "t", expires_at: "2026-11-15T10:00:00Z", agent_id: "a" }) }, online: true, lang: "en" }));
    expect(ok).toContain("Open voice buddy");
    expect(wrap("en", h(BuddyVoice, { source: { ok: true, fetch: async () => { throw new Error("x"); } }, online: false, lang: "en" }))).toContain("needs a connection");
  });

  it("the screen renders in mock mode with recorder, buddy and queue", () => {
    const client = createClient({ mock: true, invoker: { invokeFunction: async () => { throw new Error("no platform in mock"); } } }).forScreen(screen.functions);
    const html = wrap("el", h(Record, { screen, client, navigate: () => undefined, lang: "el" }));
    expect(html).toContain("Καταγραφή επίσκεψης");
    expect(html).toContain("Έναρξη ηχογράφησης");
    expect(html).toContain("Μίλα με τον βοηθό");
    expect(html).toContain("Πρόσφατες ηχογραφήσεις");
  });

  it("the screen client refuses functions not listed for /rep/record (REQ-APP-001)", async () => {
    const client = createClient({ mock: true, invoker: { invokeFunction: async () => ({}) } }).forScreen(screen.functions);
    await expect(client.call("today-get", {} as never)).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.call("voice-log-upload", { idempotency_key: "k", recorded_at: "2026-11-15T09:00:00Z" })).resolves.toHaveProperty("voice_log_id");
  });
});
