/** Test-only: render a screen view to static HTML inside the i18n provider (see uiStub.ts). */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider, type Lang } from "../../../../lib/i18n";

export function renderForTest(el: ReactElement, lang: Lang = "el"): string {
  return renderToStaticMarkup(createElement(I18nProvider, { lang, children: el }));
}

/** Visible text only (tags stripped, whitespace collapsed). */
export function getText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
