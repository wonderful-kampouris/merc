import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { ActionLine } from "../../../contracts";
import { checkScreenMessages } from "../../../lib/i18n";
import { createOverride, getMerged } from "../approvals/kit/overrides";
import { createScreenTestClient } from "../approvals/kit/testClient";
import { getText, renderForTest } from "../approvals/kit/renderForTest";
import messages from "./i18n";
import { canUndo, getActionId, getUndone, humanize, listRequest } from "./logic";

vi.mock("@wonderful/ui-base", () => import("../approvals/kit/uiStub"));
const { default: AiLogView } = await import("./AiLogView");

const line = (over: Partial<ActionLine> = {}): ActionLine => ({
  ai_action_id: "7d4cd9c6-6c86-4f25-83ad-f1e89ff2dddf",
  action_type: "deal_stage_update",
  action_class: "internal",
  status: "applied",
  summary: "Moved Café Miltos deal to negotiation",
  target_table: "deal",
  target_id: "x",
  undoable: true,
  approval_id: null,
  ...over,
});
const noop = () => {};
const props = (over: Partial<Parameters<typeof AiLogView>[0]> = {}): Parameters<typeof AiLogView>[0] => ({
  state: { status: "ready", data: { items: [line()], total: 3 }, refreshing: false },
  filter: "all",
  busy: null,
  feedback: null,
  onFilter: noop,
  onRetry: noop,
  onUndo: noop,
  onMore: noop,
  onOpenApprovals: noop,
  onDismissFeedback: noop,
  ...over,
});

describe("rep AI log logic", () => {
  it("undo only for applied undoable actions", () => {
    expect(canUndo(line())).toBe(true);
    expect(canUndo(line({ status: "undone" }))).toBe(false);
    expect(canUndo(line({ undoable: false }))).toBe(false);
    expect(canUndo(line({ status: "suggested" }))).toBe(false);
    expect(humanize("deal_stage_update")).toBe("Deal stage update");
    expect(listRequest("all", 40)).toEqual({ status: null, page: 1, limit: 40 });
  });

  it("undo from the log (REQ-APP-004): ai-action-undo answers undone and the line stays undone over a refetch", async () => {
    const { client, calls } = createScreenTestClient("/rep/ai-log");
    const list = await client.call("ai-actions-list", listRequest("all", 20));
    const a = { ...list.items[0]!, status: "applied" as const, undoable: true };
    const r = await client.call("ai-action-undo", { ai_action_id: a.ai_action_id });
    expect(r.status).toBe("undone");
    const map = createOverride(new Map(), a.ai_action_id, a, getUndone(a));
    const again = getMerged([a], getActionId, map);
    expect(again[0]!.status).toBe("undone");
    expect(canUndo(again[0]!)).toBe(false);
    expect(calls).toEqual(["ai-actions-list", "ai-action-undo"]);
  });
});

describe("rep AI log view", () => {
  it("dictionary is complete", () => expect(checkScreenMessages(messages)).toEqual([]));

  it("lines with class, status, undo and paging; Greek default", () => {
    const el = getText(renderForTest(h(AiLogView, props())));
    expect(el).toContain("Αναίρεση");
    expect(el).toContain("Ενημέρωση CRM");
    expect(el).toContain("1 από 3");
    const en = getText(renderForTest(h(AiLogView, props()), "en"));
    expect(en).toContain("Moved Café Miltos deal to negotiation");
    expect(en).toContain("Deal stage update · deal");
    expect(renderForTest(h(AiLogView, props()), "en")).toMatch(/>Undo<\/ui-button>/);
    expect(en).toContain("Show more");
    const undoneHtml = renderForTest(h(AiLogView, props({ state: { status: "ready", data: { items: [line({ status: "undone", undoable: false, approval_id: "3d8bef3a-49a4-4e07-84fc-8cbccace7ea1" })], total: 1 }, refreshing: false } })), "en");
    expect(undoneHtml).not.toMatch(/>Undo<\/ui-button>/);
    const undone = getText(undoneHtml);
    expect(undone).toContain("Undone");
    expect(undone).toContain("Open approval");
  });

  it("loading, empty, error", () => {
    expect(renderForTest(h(AiLogView, props({ state: { status: "loading" } })))).toContain("ui-skeleton-text");
    expect(getText(renderForTest(h(AiLogView, props({ state: { status: "ready", data: { items: [], total: 0 }, refreshing: false } })), "en"))).toContain("No AI actions yet");
    expect(getText(renderForTest(h(AiLogView, props({ state: { status: "error", error: new Error("x") } })), "en"))).toContain("Try again");
  });
});
