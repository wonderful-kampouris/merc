import { expect, test, vi } from "vitest";
vi.mock("@wonderful/ui-base", () => import("../dashboard/shared/uiStub"));
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TargetProgress } from "../../../contracts";
import { createClient } from "../../../lib/client";
import { I18nProvider, translateScreen, type Lang } from "../../../lib/i18n";
import { SCREENS } from "../../../lib/routes";
import Targets, { TargetsView } from "./index";
import messages from "./i18n";

const tr = (lang: Lang) => ((k: string, v?: Record<string, string | number>) => translateScreen(messages, lang, k, v)) as never;
const items = [
  { target_id: "t1", metric: "revenue", period_start: "2026-11-01", period_end: "2026-11-30", target_value: 3000000, actual_value: 1200000, pct: 40, days_left: 15, user_id: "d72bccf8-f36c-5abf-8d0d-142783f090cd" },
  { target_id: "t2", metric: "visits", period_start: "2026-11-01", period_end: "2026-11-30", target_value: 80, actual_value: 70, pct: 87.5, days_left: 15 },
] as TargetProgress[];

test("list view in Greek and English", () => {
  const el = renderToStaticMarkup(h(TargetsView, { items, lang: "el", t: tr("el"), onEdit: () => {} }));
  expect(el).toContain("Έσοδα");
  expect(el).toContain("Nikos Alexiou");
  expect(el).toContain("15 ημέρες απομένουν");
  const en = renderToStaticMarkup(h(TargetsView, { items, lang: "en", t: tr("en"), onEdit: () => {} }));
  expect(en).toContain("€12k of €30k · 40%");
  expect(en).toContain("70 of 80 · 88%");
});

test("screen mounts in mock mode", () => {
  const screen = SCREENS.find((s) => s.route === "/mgmt/targets")!;
  const client = createClient({ mock: true, invoker: { invokeFunction: async () => ({}) } }).forScreen(screen.functions);
  const html = renderToStaticMarkup(h(I18nProvider, { lang: "el" }, h(Targets, { screen, client, navigate: () => {}, lang: "el" })));
  expect(html).toContain("Στόχοι");
  expect(html).toContain("Νέος στόχος");
  expect(html).toContain('data-state="loading"');
});
