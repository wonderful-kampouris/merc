import { describe, expect, it } from "vitest";
import { callMock } from "../../../contracts";
import { apiBase, buddyConfig } from "./buddy";
import { applyUndo, canUndo, cardCounts, seconds, sortLines, type ResultCard } from "./resultCard";
import { isFresh, tokenSource, toSdkToken, type ChatToken } from "./token";
import { formatDuration, pickMime, stripDataUrl } from "./recorder";
import { checkScreenMessages } from "../../../lib/i18n";
import messages from "./i18n";
import { SCREENS } from "../../../lib/routes";

const mockCard = (): ResultCard => {
  const r = callMock("debrief-result-get", { voice_log_id: "00000000-0000-4000-8000-000000000001" });
  if ("error" in r) throw new Error("mock failed");
  return r.result as ResultCard;
};
const line = (id: string, status: "applied" | "suggested" | "undone" | "rejected", cls: "internal" | "draft" | "external" = "internal", undoable = true) =>
  ({ ai_action_id: id, action_type: "note", action_class: cls, status, summary: id, undoable }) as ResultCard["lines"][number];

describe("result card", () => {
  it("undo marks only that line undone and not undoable", () => {
    const card = { ...mockCard(), lines: [line("a", "applied"), line("b", "applied")] };
    const next = applyUndo(card, "a");
    expect(next.lines[0]).toMatchObject({ status: "undone", undoable: false });
    expect(next.lines[1]!.status).toBe("applied");
    expect(card.lines[0]!.status).toBe("applied"); // pure
  });
  it("only applied, undoable lines offer undo", () => {
    expect(canUndo(line("a", "applied"))).toBe(true);
    expect(canUndo(line("a", "suggested"))).toBe(false);
    expect(canUndo(line("a", "applied", "internal", false))).toBe(false);
  });
  it("sorts applied before suggested, internal before external, stable otherwise", () => {
    const s = sortLines([line("x", "suggested"), line("e", "applied", "external"), line("i1", "applied"), line("i2", "applied")]);
    expect(s.map((l) => l.ai_action_id)).toEqual(["i1", "i2", "e", "x"]);
  });
  it("counts and timing", () => {
    const c = { ...mockCard(), lines: [line("a", "applied"), line("b", "suggested")], processing_ms: 8420 };
    expect(cardCounts(c)).toEqual({ applied: 1, questions: c.missing_fields.length, approvals: c.pending_approvals.filter((a) => a.status === "pending").length });
    expect(seconds(c.processing_ms)).toBe("8.4");
  });
});

describe("buddy token (REQ-BUD-002)", () => {
  const tok = (min: number): ChatToken => ({ token: "jwt", agent_id: "agent-1", expires_at: new Date(Date.now() + min * 60_000).toISOString() });
  it("uses fn:merc-chat-token only when app.json lists it for the screen", () => {
    expect(tokenSource({ functions: ["voice-log-upload"], mock: false, call: async () => tok(60) })).toEqual({ ok: false, reason: "not_listed" });
    expect(tokenSource({ functions: ["merc-chat-token"], mock: true, call: async () => tok(60) })).toEqual({ ok: false, reason: "mock" });
    expect(tokenSource({ functions: ["merc-chat-token"], mock: false, call: async () => tok(60) }).ok).toBe(true);
  });
  it("maps to the SDK token shape and refreshes through the function", async () => {
    let n = 0;
    const sdk = toSdkToken(tok(60), async () => ({ ...tok(60), token: `jwt${++n}` }));
    expect(sdk.token).toBe("jwt");
    expect(await sdk.refresh()).toMatchObject({ token: "jwt1" });
    expect(isFresh(tok(60))).toBe(true);
    expect(isFresh(tok(2))).toBe(false);
  });
  it("buddy config is voice-only with the signed token, no SDK key", () => {
    const cfg = buddyConfig({ token: toSdkToken(tok(60), async () => tok(60)), agentId: "agent-1", lang: "el", title: "Merc" });
    expect(cfg.modalities).toEqual(["voice"]);
    expect(cfg).not.toHaveProperty("key");
    expect((cfg.token as { token: string }).token).toBe("jwt");
    expect(apiBase("https://default.api.x.sb.wonderful.ai/api/v1/")).toBe("https://default.api.x.sb.wonderful.ai");
    expect(apiBase("/relative")).toMatch(/^https:\/\//);
  });
});

describe("recorder helpers", () => {
  it("picks the first supported mime and strips data URLs", () => {
    expect(pickMime((m) => m === "audio/mp4")).toBe("audio/mp4");
    expect(pickMime(() => false)).toBeUndefined();
    expect(stripDataUrl("data:audio/webm;base64,QUJD")).toBe("QUJD");
    expect(formatDuration(65_000)).toBe("1:05");
  });
});

describe("screen contract", () => {
  it("i18n: el and en have the same, non-empty keys", () => {
    expect(checkScreenMessages(messages)).toEqual([]);
  });
  it("record screen is offline-capable and lists the functions this screen calls", () => {
    const s = SCREENS.find((x) => x.route === "/rep/record")!;
    expect(s.offline).toBe(true);
    expect(s.functions).toEqual(["voice-log-upload", "debrief-result-get", "ai-action-undo", "merc-chat-token"]);
  });
  it("REQ-BUD-001/002: with the app.json list the buddy gets its token from fn:merc-chat-token (live mode)", async () => {
    const s = SCREENS.find((x) => x.route === "/rep/record")!;
    const calls: string[] = [];
    const src = tokenSource({ functions: s.functions, mock: false, call: async () => (calls.push("merc-chat-token"), (callMock("merc-chat-token", {}) as { result: ChatToken }).result) });
    expect(src.ok).toBe(true);
    if (!src.ok) return;
    const tok = await src.fetch();
    expect(calls).toEqual(["merc-chat-token"]);
    expect(typeof tok.token).toBe("string");
    expect(typeof tok.agent_id).toBe("string");
  });
});
