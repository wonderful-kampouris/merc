import { expect, test, vi } from "vitest";
vi.mock("@wonderful/ui-base", () => import("../dashboard/shared/uiStub"));
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { seedRows } from "../../../contracts";
import { createClient } from "../../../lib/client";
import { I18nProvider, translateScreen, type Lang } from "../../../lib/i18n";
import { SCREENS } from "../../../lib/routes";
import Pipeline, { PipelineBoard } from "./index";
import messages from "./i18n";
import { toDeal } from "./logic";

const tr = (lang: Lang) => ((k: string, v?: Record<string, string | number>) => translateScreen(messages, lang, k, v)) as never;
const deals = seedRows("deal").map((r) => toDeal(r)!);
const props = (lang: Lang) => ({ deals, total: deals.length, lang, t: tr(lang), accountName: () => "Café Miltos", onMove: () => {}, onOpen: () => {} });

test("board in Greek: totals, stage cards with probability, deals with move control", () => {
  const html = renderToStaticMarkup(h(PipelineBoard, props("el")));
  expect(html).toContain("Σταθμισμένες ευκαιρίες");
  expect(html).toContain("Διαπραγμάτευση · 70%");
  expect(html).toContain("Espresso 20kg monthly");
  expect(html).toContain("Μετακίνηση σε στάδιο");
});

test("board in English and filtered-to-nothing message", () => {
  expect(renderToStaticMarkup(h(PipelineBoard, props("en")))).toContain("Weighted pipeline");
  expect(renderToStaticMarkup(h(PipelineBoard, { ...props("en"), deals: [] }))).toContain("No deals match the filters.");
});

test("screen mounts in mock mode with the loading state", () => {
  const screen = SCREENS.find((s) => s.route === "/mgmt/pipeline")!;
  const client = createClient({ mock: true, invoker: { invokeFunction: async () => ({}) } }).forScreen(screen.functions);
  const html = renderToStaticMarkup(h(I18nProvider, { lang: "el" }, h(Pipeline, { screen, client, navigate: () => {}, lang: "el" })));
  expect(html).toContain("Ευκαιρίες");
  expect(html).toContain("Νέα ευκαιρία");
  expect(html).toContain('data-state="loading"');
});
