/** Test helpers for the WP-APP-07 screens (not a test file itself). */
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createClient, type MercClient } from "../../../lib/client";
import { I18nProvider, type Lang } from "../../../lib/i18n";
import { findScreen, type Screen } from "../../../lib/routes";
import type { ScreenProps } from "../../../lib/screenRegistry";

export function screenOf(route: string): Screen {
  const s = findScreen(route);
  if (!s) throw new Error(`no app.json screen for ${route}`);
  return s;
}

/** A mock-mode client limited to the screen's app.json functions, recording every slug it is asked for. */
export function mockClient(screen: Screen): { client: MercClient; calls: string[] } {
  const calls: string[] = [];
  const base = createClient({ mock: true, invoker: { invokeFunction: async <T,>() => ({}) as T } }).forScreen(screen.functions);
  const client: MercClient = {
    mock: true,
    forScreen: base.forScreen,
    call: ((slug: string, body?: unknown) => {
      calls.push(slug);
      return base.call(slug as never, body as never);
    }) as MercClient["call"],
  };
  return { client, calls };
}

/** Server-render a screen (first paint: loading state) inside the i18n provider. */
export function renderScreen(Comp: ComponentType<ScreenProps>, route: string, lang: Lang = "el"): string {
  const screen = screenOf(route);
  const { client } = mockClient(screen);
  return renderToString(createElement(I18nProvider, { lang, children: createElement(Comp, { screen, client, navigate: () => {}, lang }) }));
}
