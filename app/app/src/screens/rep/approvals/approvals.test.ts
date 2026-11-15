import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { ApprovalCard } from "../../../contracts";
import { checkScreenMessages } from "../../../lib/i18n";
import { createScreenTestClient } from "./kit/testClient";
import { getText, renderForTest } from "./kit/renderForTest";
import messages from "./i18n";
import { canEdit, canResolve, createResolveBody, getLiveChange, getResult, getVisible } from "./logic";

vi.mock("@wonderful/ui-base", () => import("./kit/uiStub"));
const { default: ApprovalsView } = await import("./ApprovalsView");

const card = (over: Partial<ApprovalCard> = {}): ApprovalCard => ({
  approval_id: "3d8bef3a-49a4-4e07-84fc-8cbccace7ea1",
  kind: "customer_message",
  status: "pending",
  mode: "async",
  account: { id: "59b5e454-cc4b-5fab-939b-a50c78e8aa9b", name: "Café Miltos", account_type: "customer" },
  requested_by: { id: "bcc2830f-a618-5ab1-bb5c-46707c21a9e6", full_name: "Nikos Papadopoulos", role: "rep" },
  approver: { id: "bcc2830f-a618-5ab1-bb5c-46707c21a9e6", full_name: "Nikos Papadopoulos", role: "rep" },
  preview: "Follow-up to Café Miltos",
  recipient: "miltos@example.gr",
  subject: "Our visit on Thursday",
  body: "Hello Miltos, see you Thursday.",
  created_at: "2026-11-15T09:00:00.000Z",
  ...over,
});
const noop = () => {};
const props = (over: Partial<Parameters<typeof ApprovalsView>[0]> = {}): Parameters<typeof ApprovalsView>[0] => ({
  state: { status: "ready", data: [card()], refreshing: false },
  filter: "open",
  live: null,
  busy: {},
  editing: null,
  calls: {},
  feedback: null,
  onFilter: noop,
  onRetry: noop,
  onResolve: noop,
  onEdit: noop,
  onEditChange: noop,
  onCancelEdit: noop,
  onCheckStatus: noop,
  onDismissFeedback: noop,
  ...over,
});

describe("rep approvals logic", () => {
  it("rep resolves messages and conversions, edits only messages, follows discounts", () => {
    expect(canResolve(card())).toBe(true);
    expect(canEdit(card())).toBe(true);
    expect(canResolve(card({ kind: "conversion" }))).toBe(true);
    expect(canEdit(card({ kind: "conversion" }))).toBe(false);
    expect(canResolve(card({ kind: "discount" }))).toBe(false);
    expect(canResolve(card({ status: "failed" }))).toBe(true);
    expect(canResolve(card({ status: "sent" }))).toBe(false);
  });

  it("edit then approve sends the edited body; approve and reject send none", () => {
    expect(createResolveBody(card(), "edit_approve", "See you Friday")).toEqual({ approval_id: card().approval_id, decision: "edit_approve", final_body: "See you Friday" });
    expect(createResolveBody(card(), "approve")).toEqual({ approval_id: card().approval_id, decision: "approve" });
  });

  it("open filter keeps pending/failed first and newest first", () => {
    const items = [card({ approval_id: "a", status: "sent" }), card({ approval_id: "b", created_at: "2026-11-14T09:00:00Z" }), card({ approval_id: "c", status: "failed" })];
    expect(getVisible(items, "open").map((a) => a.approval_id)).toEqual(["c", "b"]);
    expect(getVisible(items, "all").map((a) => a.approval_id)).toEqual(["c", "b", "a"]);
    expect(getResult(card({ status: "sent" })).key).toBe("result.sent");
    expect(getResult(card({ status: "failed" })).kind).toBe("error");
  });

  it("reads live events", () => {
    expect(getLiveChange({ type: "manager_call.status", at: "", payload: { approval_id: "x", outcome: "ringing" } })).toEqual({ type: "call", approvalId: "x", outcome: "ringing" });
    expect(getLiveChange({ type: "approval.decided", at: "", payload: { approval: card() } })?.type).toBe("approval");
  });

  it("approve, edit-approve and status run through the contract mocks with the screen's function list only", async () => {
    const { client, calls } = createScreenTestClient("/rep/approvals");
    const list = await client.call("approvals-list", {});
    expect(list.items.length).toBeGreaterThan(0);
    const a = list.items[0]!;
    expect((await client.call("approval-resolve", createResolveBody(a, "edit_approve", "Friday instead"))).approval.approval_id).toMatch(/-/);
    await client.call("approval-status", { approval_id: a.approval_id });
    expect(calls).toEqual(["approvals-list", "approval-resolve", "approval-status"]);
    await expect(client.call("alerts-list" as never, {} as never)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("rep approvals view", () => {
  it("dictionary is complete in el and en", () => expect(checkScreenMessages(messages)).toEqual([]));

  it("renders Greek by default and English on toggle, with the actions", () => {
    const el = getText(renderForTest(h(ApprovalsView, props())));
    expect(el).toContain("Μήνυμα σε πελάτη");
    expect(el).toContain("Έγκριση & αποστολή");
    expect(el).toContain("Επεξεργασία");
    expect(el).toContain("Απόρριψη");
    expect(el).toContain("Hello Miltos, see you Thursday.");
    const en = getText(renderForTest(h(ApprovalsView, props()), "en"));
    expect(en).toContain("Approve & send");
    expect(en).toContain("To: miltos@example.gr");
  });

  it("edit mode shows the text box and save & send", () => {
    const html = renderForTest(h(ApprovalsView, props({ editing: { id: card().approval_id, body: "See you Friday" } })), "en");
    expect(html).toContain("ui-textarea");
    expect(html).toContain('data-value="See you Friday"');
    expect(getText(html)).toContain("Save & send");
    expect(getText(html)).not.toContain("Reject");
  });

  it("a discount shows manager call progress and check status, no approve", () => {
    const d = card({ kind: "discount", mode: "live", requested_pct: 8, policy_limit_pct: 5, approver: { id: "bcc2830f-a618-5ab1-bb5c-46707c21a9e6", full_name: "Eleni Georgiou", role: "manager" } });
    const txt = getText(renderForTest(h(ApprovalsView, props({ state: { status: "ready", data: [d], refreshing: false }, calls: { [d.approval_id]: "ringing" } })), "en"));
    expect(txt).toContain("8% requested · limit 5%");
    expect(txt).toContain("Calling the manager…");
    expect(txt).toContain("Approver: Eleni Georgiou");
    expect(txt).toContain("Check status");
    expect(txt).not.toContain("Approve & send");
  });

  it("shows a realistic expiry distinct from creation, only while pending (Athens time, el + en)", () => {
    const a = card({ created_at: "2026-11-15T09:00:00.000Z", expires_at: "2026-11-17T15:30:00.000Z" });
    const one = (c: ApprovalCard, lang?: "en") => getText(renderForTest(h(ApprovalsView, props({ state: { status: "ready", data: [c], refreshing: false } })), lang));
    const en = one(a, "en");
    expect(en).toContain("Created 15 Nov, 11:00");
    expect(en).toContain("Expires 17 Nov, 17:30");
    expect(one(a)).toMatch(/17 Νοε, 17:30/);
    expect(one({ ...a, status: "approved" }, "en")).not.toContain("Expires");
  });

  it("loading, empty and error states", () => {
    expect(renderForTest(h(ApprovalsView, props({ state: { status: "loading" } })))).toContain("ui-skeleton-text");
    expect(getText(renderForTest(h(ApprovalsView, props({ state: { status: "ready", data: [], refreshing: false } })), "en"))).toContain("Nothing to approve");
    const err = getText(renderForTest(h(ApprovalsView, props({ state: { status: "error", error: new Error("offline") } })), "en"));
    expect(err).toContain("Couldn't load this");
    expect(err).toContain("Try again");
  });
});
