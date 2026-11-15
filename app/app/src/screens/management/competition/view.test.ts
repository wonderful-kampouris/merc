import { expect, test, vi } from "vitest";
vi.mock("@wonderful/ui-base", () => import("../dashboard/shared/uiStub"));
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { seedRows } from "../../../contracts";
import { createClient } from "../../../lib/client";
import { I18nProvider, translateScreen, type Lang } from "../../../lib/i18n";
import { SCREENS } from "../../../lib/routes";
import { directory } from "../dashboard/shared/directory";
import Competition, { CompetitionView } from "./index";
import messages from "./i18n";
import { toSignal } from "./logic";

const tr = (lang: Lang) => ((k: string, v?: Record<string, string | number>) => translateScreen(messages, lang, k, v)) as never;
const signals = seedRows("competitor_signal").map((r) => toSignal(r, directory()));

test("view in Greek and English: breakdowns and signals", () => {
  const el = renderToStaticMarkup(h(CompetitionView, { signals, lang: "el", t: tr("el"), onCompetitor: () => {}, onTerritory: () => {} }));
  expect(el).toContain("Ανά ανταγωνιστή");
  expect(el).toContain('data-bucket="Aroma Delta"');
  expect(el).toContain('data-bucket="North"');
  expect(el).toContain("3 σήματα");
  const en = renderToStaticMarkup(h(CompetitionView, { signals, lang: "en", t: tr("en"), onCompetitor: () => {}, onTerritory: () => {} }));
  expect(en).toContain("Aroma Delta offered 15% lower");
  expect(en).toContain("−15% price");
  expect(en).toContain("Nikos Alexiou");
});

test("screen mounts in mock mode", () => {
  const screen = SCREENS.find((s) => s.route === "/mgmt/competition")!;
  const client = createClient({ mock: true, invoker: { invokeFunction: async () => ({}) } }).forScreen(screen.functions);
  const html = renderToStaticMarkup(h(I18nProvider, { lang: "en" }, h(Competition, { screen, client, navigate: () => {}, lang: "en" })));
  expect(html).toContain("Competition");
  expect(html).toContain('data-state="loading"');
});
