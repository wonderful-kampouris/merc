import { describe, expect, it, vi } from "vitest";
vi.mock("@wonderful/ui-base", () => import("./testing/uiStub"));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider, type Lang } from "../../../lib/i18n";
import type { TodayLoad } from "./loadToday";
import { briefingResult, performanceResult, todayResult } from "./testing/fixtures";
import TodayView, { type TodayViewState } from "./TodayView";

const NOW = new Date(2026, 10, 15, 9, 0);
const load = (over: Partial<TodayLoad> = {}): TodayLoad => ({
  data: { today: todayResult(), briefing: briefingResult(), plan: null, performance: performanceResult() },
  source: "live",
  savedAt: new Date(2026, 10, 15, 7, 30).toISOString(),
  stale: false,
  fallbackReason: null,
  failed: [],
  ...over,
});
const noop = () => {};
const render = (state: TodayViewState, lang: Lang = "el") =>
  renderToStaticMarkup(
    createElement(I18nProvider, { lang }, createElement(TodayView, { state, lang, mock: false, offlineCapable: true, live: null, now: NOW, onRetry: noop, onOpenAccount: noop, onRecord: noop, onOpenWeek: noop })),
  );

describe("TodayView", () => {
  it("renders in Greek by default with today's stops in route order", () => {
    const html = render({ status: "ready", load: load(), refreshing: false });
    expect(html).toContain("Σήμερα");
    expect(html).toContain("3 στάσεις");
    const listAt = html.indexOf('data-ui="Card.List"');
    const order = ["Café Miltos", "Bistro Lofos", "Café Avra"].map((n) => html.indexOf(n, listAt));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("Επόμενη: Bistro Lofos");
    expect(html).toContain("Hasn&#x27;t ordered in 12 days");
  });

  it("renders in English and shows briefing items by position and the week targets", () => {
    const html = render({ status: "ready", load: load(), refreshing: false }, "en");
    expect(html).toContain("Today");
    expect(html).toContain("Morning briefing");
    expect(html.indexOf("Start at Café Miltos")).toBeLessThan(html.indexOf("Lofos: going quiet"));
    expect(html).toContain("€12,600 / €18,000");
    expect(html).toContain("15 days left");
  });

  it("shows the offline banner when the data comes from the cache", () => {
    const html = render({ status: "ready", load: load({ source: "cache", fallbackReason: "offline" }), refreshing: false }, "en");
    expect(html).toContain("Offline");
    expect(html).toContain("Showing the plan saved at");
    expect(html).toContain("Café Miltos");
    const el = render({ status: "ready", load: load({ source: "cache", fallbackReason: "offline" }), refreshing: false });
    expect(el).toContain("Χωρίς σύνδεση");
  });

  it("has loading, empty and error states", () => {
    expect(render({ status: "loading" })).toContain('aria-busy="true"');
    const empty = load();
    empty.data = { ...empty.data, today: { ...empty.data.today, visits: [] } };
    expect(render({ status: "ready", load: empty, refreshing: false })).toContain("Καμία επίσκεψη σήμερα");
    const err = render({ status: "error", reason: "offline" }, "en");
    expect(err).toContain("Could not load today");
    expect(err).toContain("No saved plan on this device yet");
    expect(err).toContain("Try again");
  });
});
