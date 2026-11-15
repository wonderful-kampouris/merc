import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { VisitSummary } from "../../../contracts";
import { checkScreenMessages } from "../../../lib/i18n";
import { createOverride } from "../approvals/kit/overrides";
import { createScreenTestClient } from "../approvals/kit/testClient";
import { getText, renderForTest } from "../approvals/kit/renderForTest";
import messages from "./i18n";
import { canAccept, countVisits, createMoveBody, createReorderBody, createSkipBody, getMergedPlan, type Plan } from "./logic";

vi.mock("@wonderful/ui-base", () => import("../approvals/kit/uiStub"));
const { default: WeekView } = await import("./WeekView");

const visit = (id: string, name: string, date: string, pos: number, over: Partial<VisitSummary> = {}): VisitSummary => ({
  visit_id: `00000000-0000-4000-8000-00000000000${id}`,
  account: { id: "59b5e454-cc4b-5fab-939b-a50c78e8aa9b", name, account_type: "customer", city: "Chalandri" },
  planned_date: date,
  route_position: pos,
  status: "planned",
  purpose: "routine",
  ...over,
});
const plan = (): Plan => ({
  plan_id: "ae919fb8-52f2-4007-8912-4faa6e702ff1",
  week_start: "2026-11-16",
  status: "proposed",
  days: [
    { date: "2026-11-16", visits: [visit("1", "Café Miltos", "2026-11-16", 1), visit("2", "Lofos", "2026-11-16", 2)] },
    { date: "2026-11-17", visits: [visit("3", "Fournos", "2026-11-17", 1, { status: "done" })] },
  ],
});
const noop = () => {};
const props = (over: Partial<Parameters<typeof WeekView>[0]> = {}): Parameters<typeof WeekView>[0] => ({
  state: { status: "ready", data: plan(), refreshing: false },
  accepting: false,
  edit: null,
  busyVisit: null,
  feedback: null,
  onWeek: noop,
  onAccept: noop,
  onRetry: noop,
  onEdit: noop,
  onConfirmEdit: noop,
  onReorder: noop,
  onDismissFeedback: noop,
  ...over,
});

describe("rep week logic", () => {
  it("accept only a proposed/edited plan", () => {
    expect(canAccept(plan())).toBe(true);
    expect(canAccept({ ...plan(), status: "accepted" })).toBe(false);
    expect(canAccept({ ...plan(), plan_id: null })).toBe(false);
    expect(countVisits(plan())).toBe(3);
  });

  it("move / skip / reorder bodies carry reason and 1-based position (REQ-PLN-003)", () => {
    const p = plan();
    const lofos = p.days[0]!.visits[1]!;
    expect(createMoveBody(lofos, "2026-11-20", " closed Monday ")).toEqual({ visit_id: lofos.visit_id, action: "move", date: "2026-11-20", reason: "closed Monday" });
    expect(createSkipBody(lofos, "")).toEqual({ visit_id: lofos.visit_id, action: "skip", reason: null });
    expect(createReorderBody(p.days[0]!, lofos, -1)).toEqual({ visit_id: lofos.visit_id, action: "reorder", date: "2026-11-16", position: 1 });
    expect(createReorderBody(p.days[0]!, lofos, 1)).toBeNull();
  });

  it("a moved visit leaves its day and joins the new one", () => {
    const p = plan();
    const lofos = p.days[0]!.visits[1]!;
    const map = createOverride(new Map(), lofos.visit_id, lofos, { ...lofos, planned_date: "2026-11-17", route_position: 2 });
    const merged = getMergedPlan(p, map);
    expect(merged.days[0]!.visits.map((v) => v.account.name)).toEqual(["Café Miltos"]);
    expect(merged.days[1]!.visits.map((v) => v.account.name)).toEqual(["Fournos", "Lofos"]);
  });

  it("plan get, visit update and accept run through the contract mocks", async () => {
    const { client, calls } = createScreenTestClient("/rep/week");
    const p = await client.call("visit-plan-get", { week_start: null });
    const v = p.days[0]!.visits[0]!;
    const r = await client.call("visit-update", createMoveBody(v, p.week_start, "closed"));
    expect(typeof r.day_count).toBe("number");
    const a = await client.call("visit-plan-accept", { plan_id: p.plan_id! });
    expect(a.plan_id).toBe(p.plan_id);
    expect(calls).toEqual(["visit-plan-get", "visit-update", "visit-plan-accept"]);
  });
});

describe("rep week view", () => {
  it("dictionary is complete", () => expect(checkScreenMessages(messages)).toEqual([]));

  it("days, visits in route order, accept button; Greek default", () => {
    const el = getText(renderForTest(h(WeekView, props())));
    expect(el).toContain("Αποδοχή εβδομάδας");
    expect(el).toContain("Μετακίνηση");
    expect(el).toContain("Τακτική επίσκεψη");
    const en = getText(renderForTest(h(WeekView, props()), "en"));
    expect(en).toContain("Accept my week");
    expect(en).toMatch(/Café Miltos.*Lofos.*Fournos/);
    expect(en).toContain("Done");
    expect(en).toContain("Week of Mon 16 Nov · 3 visits");
  });

  it("accepted plan hides the accept card; move editor shows the day picker", () => {
    const accepted = getText(renderForTest(h(WeekView, props({ state: { status: "ready", data: { ...plan(), status: "accepted" }, refreshing: false } })), "en"));
    expect(accepted).not.toContain("Accept my week");
    expect(accepted).toContain("You accepted this plan");
    const lofos = plan().days[0]!.visits[1]!;
    const html = renderForTest(h(WeekView, props({ edit: { visitId: lofos.visit_id, mode: "move", date: "2026-11-16", reason: "" } })), "en");
    expect(html).toContain("ui-select");
    expect(getText(html)).toContain("Move visit");
  });

  it("loading, empty, error", () => {
    expect(renderForTest(h(WeekView, props({ state: { status: "loading" } })))).toContain("ui-skeleton-text");
    const empty = { ...plan(), plan_id: null, days: [] };
    expect(getText(renderForTest(h(WeekView, props({ state: { status: "ready", data: empty, refreshing: false } })), "en"))).toContain("No plan for this week yet");
    expect(getText(renderForTest(h(WeekView, props({ state: { status: "error", error: new Error("x") } })), "en"))).toContain("Try again");
  });
});
