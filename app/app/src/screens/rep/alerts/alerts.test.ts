import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { AlertCard } from "../../../contracts";
import { checkScreenMessages } from "../../../lib/i18n";
import { createScreenTestClient } from "../approvals/kit/testClient";
import { getText, renderForTest } from "../approvals/kit/renderForTest";
import messages from "./i18n";
import { getPrimaryAction, getVisible, listRequest } from "./logic";

vi.mock("@wonderful/ui-base", () => import("../approvals/kit/uiStub"));
const { default: AlertsView } = await import("./AlertsView");

const alert = (over: Partial<AlertCard> = {}): AlertCard => ({
  alert_id: "1b7844cb-19b9-4f18-8ed3-bbe9a1da1ef6",
  type: "visit_overdue",
  severity: "high",
  status: "open",
  message: "Lofos has not been visited for 12 days.",
  account: { id: "59b5e454-cc4b-5fab-939b-a50c78e8aa9b", name: "Lofos", account_type: "customer", city: "Marousi" },
  suggested_action: "Plan a visit",
  created_at: "2026-11-15T07:00:00.000Z",
  ...over,
});
const noop = () => {};
const props = (over: Partial<Parameters<typeof AlertsView>[0]> = {}): Parameters<typeof AlertsView>[0] => ({
  state: { status: "ready", data: [alert()], refreshing: false },
  filter: "open",
  live: "polling",
  busy: {},
  feedback: null,
  onFilter: noop,
  onRetry: noop,
  onAct: noop,
  onOpenApprovals: noop,
  onDismissFeedback: noop,
  ...over,
});

describe("rep alerts logic", () => {
  it("suggested action becomes a task or a message draft", () => {
    expect(getPrimaryAction(alert())).toBe("create_task");
    expect(getPrimaryAction(alert({ type: "deal_stuck", suggested_action: "Follow-up email" }))).toBe("create_draft");
    expect(getPrimaryAction(alert({ type: "going_quiet", suggested_action: "Send a message" }))).toBe("create_draft");
  });

  it("open filter, high severity first", () => {
    const items = [alert({ alert_id: "a", severity: "low" }), alert({ alert_id: "b", status: "done" }), alert({ alert_id: "c" })];
    expect(getVisible(items, "open").map((a) => a.alert_id)).toEqual(["c", "a"]);
    expect(listRequest("open")).toEqual({ status: "open", limit: 50 });
  });

  it("alert-act runs through the contract mock for every action", async () => {
    const { client, calls } = createScreenTestClient("/rep/alerts");
    const { items } = await client.call("alerts-list", listRequest("open"));
    for (const action of ["create_task", "create_draft", "done", "dismiss"] as const) {
      const r = await client.call("alert-act", { alert_id: items[0]!.alert_id, action });
      expect(r.alert.alert_id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(calls[0]).toBe("alerts-list");
  });
});

describe("rep alerts view", () => {
  it("dictionary is complete", () => expect(checkScreenMessages(messages)).toEqual([]));

  it("shows the alert with its suggested action, Greek default", () => {
    const el = getText(renderForTest(h(AlertsView, props())));
    expect(el).toContain("Lofos · Marousi");
    expect(el).toContain("Καθυστερημένη επίσκεψη");
    expect(el).toContain("Πρόταση: Plan a visit");
    expect(el).toContain("Νέα εργασία");
    const en = getText(renderForTest(h(AlertsView, props()), "en"));
    expect(en).toContain("Create task");
    expect(en).toContain("Draft message");
    expect(en).toContain("Dismiss");
    expect(en).toContain("1 open");
  });

  it("draft feedback links to approvals", () => {
    const html = renderForTest(h(AlertsView, props({ feedback: { kind: "success", text: "Draft ready", approvals: true } })), "en");
    expect(getText(html)).toContain("Open Approvals");
  });

  it("loading, empty, error", () => {
    expect(renderForTest(h(AlertsView, props({ state: { status: "loading" } })))).toContain("ui-skeleton-text");
    expect(getText(renderForTest(h(AlertsView, props({ state: { status: "ready", data: [], refreshing: false } })), "en"))).toContain("No open alerts");
    expect(getText(renderForTest(h(AlertsView, props({ state: { status: "error", error: new Error("x") } })), "el"))).toContain("Δοκιμή ξανά");
  });
});
