import { describe, expect, test, vi } from "vitest";
vi.mock("@wonderful/ui-base", () => import("./shared/uiStub"));
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mockResult, type DashboardKpisResponse } from "../../../contracts";
import { createClient } from "../../../lib/client";
import { I18nProvider, translateScreen, type Lang } from "../../../lib/i18n";
import { SCREENS } from "../../../lib/routes";
import Dashboard, { DashboardView, TargetBars } from "./index";
import messages from "./i18n";
import { Region } from "./shared/Region";
import { MercApiError } from "../../../lib/client";

const tr = (lang: Lang) => ((k: string, v?: Record<string, string | number>) => translateScreen(messages, lang, k, v)) as never;
const screen = SCREENS.find((s) => s.route === "/mgmt/dashboard")!;
const data = (): DashboardKpisResponse => {
  const d = mockResult("dashboard-kpis", { scope: "team", from: "2026-11-01", to: "2026-11-15" });
  return { ...d, kpis: { ...d.kpis, revenue_minor: 4200000, crm_completeness_pct: 82, baseline: { crm_completeness_pct: 41 } } };
};

describe("DashboardView", () => {
  test("Greek by default: KPI tiles, baseline delta, pipeline, reps", () => {
    const html = renderToStaticMarkup(h(DashboardView, { data: data(), lang: "el", t: tr("el"), onDrill: () => {}, onRep: () => {} }));
    expect(html).toContain("Έσοδα");
    expect(html).toContain("Πληρότητα CRM");
    expect(html).toContain("πριν την έναρξη: 41%");
    expect(html).toContain("Ευκαιρίες ανά στάδιο");
    expect(html).toContain('data-drill="at_risk"');
    expect(html).toContain('data-drill="stuck_deals"');
    expect(html).not.toContain('data-drill="by_rep"');
    for (const k of ["revenue", "visits", "ai_actions", "approvals", "discounts"]) expect(html).toContain(`data-drill="${k}"`);
  });
  test("English toggle", () => {
    const html = renderToStaticMarkup(h(DashboardView, { data: data(), lang: "en", t: tr("en"), onDrill: () => {}, onRep: () => {} }));
    expect(html).toContain("Customers at risk");
    expect(html).toContain("€42k");
    expect(html).toContain("before go-live: 41%");
  });
  test("targets render progress per metric", () => {
    const items = mockResult("targets-list", {}).items;
    const html = renderToStaticMarkup(h(TargetBars, { items, lang: "en", t: tr("en") }));
    expect(html).toContain('data-ui="Progress"');
    expect(html).toContain("days left");
  });
});

describe("states", () => {
  const base = { reload: () => {} };
  const render = (state: object) =>
    renderToStaticMarkup(h(Region as never, { state: { ...base, ...state }, t: tr("en"), isEmpty: (d: unknown[]) => d.length === 0, emptyTitle: "Nothing", children: () => "CONTENT" }));
  test("loading", () => expect(render({ status: "loading" })).toContain('data-state="loading"'));
  test("error with retry", () => {
    const html = render({ status: "error", error: new MercApiError("dashboard-kpis", { code: "forbidden", message: "no" }) });
    expect(html).toContain('data-state="error"');
    expect(html).toContain("You do not have access");
    expect(html).toContain("Try again");
  });
  test("empty", () => expect(render({ status: "ok", data: [] })).toContain("Nothing"));
  test("content", () => expect(render({ status: "ok", data: [1] })).toContain("CONTENT"));
});

test("screen mounts in mock mode (first paint is the loading state)", () => {
  const client = createClient({ mock: true, invoker: { invokeFunction: async () => ({}) } }).forScreen(screen.functions);
  const html = renderToStaticMarkup(h(I18nProvider, { lang: "el" }, h(Dashboard, { screen, client, navigate: () => {}, lang: "el" })));
  expect(html).toContain("Πίνακας ελέγχου");
  expect(html).toContain('data-state="loading"');
  expect(html).toContain("Δοκιμαστικά δεδομένα");
});
