import { describe, expect, it, vi } from "vitest";
vi.mock("@wonderful/ui-base", () => import("../today/testing/uiStub"));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider, type Lang } from "../../../lib/i18n";
import { avraCard, miltosCard } from "../today/testing/fixtures";
import AccountList, { type ListState } from "./AccountList";
import VisitCardView, { type VisitCardViewProps } from "./VisitCardView";

const noop = () => {};
const card = (c: VisitCardViewProps["card"], lang: Lang = "el", over: Partial<VisitCardViewProps> = {}) =>
  renderToStaticMarkup(
    createElement(I18nProvider, { lang }, createElement(VisitCardView, {
      card: c, details: null, lang, mock: false, notice: null, busy: new Set<string>(), onBack: noop, onProblem: noop,
      onAddContact: async () => true, onReorder: noop, onDismissNotice: noop, ...over,
    })),
  );
const list = (state: ListState, q = "", lang: Lang = "el") =>
  renderToStaticMarkup(createElement(I18nProvider, { lang }, createElement(AccountList, { state, q, filter: "all", lang, mock: true, onQuery: noop, onFilter: noop, onOpen: noop, onRetry: noop })));

describe("visit card view", () => {
  it("customer card shows every REQ-CRD-001 section; Miltos mentions the grinder and the 12 kg usual order", () => {
    const html = card(miltosCard(), "en");
    for (const s of ["summary", "how_to_talk", "metrics", "alerts", "problems", "tasks", "orders", "suggested", "campaigns", "contacts"]) {
      expect(html, s).toContain(`data-section="${s}"`);
    }
    expect(html).toContain("Grinder is making noise");
    expect(html).toContain("Usual order");
    expect(html).toContain("12 kg Espresso Classico 1kg");
    expect(html).toContain("Open problem older than 7 days");
    expect(html).toContain("Miltos Papadakis");
    expect(html).toContain("Promise to customer");
    expect(html).toContain("Repeat as draft");
    expect(html).toMatch(/~\d+ s/);
  });

  it("prospect card shows facts with sources, 3 arguments, objections and competitor brands (REQ-CRD-002)", () => {
    const html = card(avraCard(), "en");
    expect(html).toContain('data-section="facts"');
    expect(html).toContain("BlueBean");
    expect(html).toContain('href="https://www.instagram.com/cafe.avra/"');
    expect(html).toContain("instagram.com");
    expect(html).toContain("1. Fresher roast");
    expect(html).toContain("3. Trial bag");
    expect(html).not.toContain("arguments instead of 3");
    expect(html).toContain("We are happy with BlueBean");
    expect(html).toContain("Run a one-week side by side");
    expect(html).not.toContain('data-section="problems"');
  });

  it("flags a pitch that does not have exactly 3 arguments", () => {
    const c = avraCard();
    c.pitch!.arguments = c.pitch!.arguments.slice(0, 2);
    expect(card(c, "en")).toContain("The pitch has 2 arguments instead of 3.");
  });

  it("is Greek by default and shows action notices", () => {
    const html = card(miltosCard(), "el", { notice: { kind: "error", text: "Δεν έγινε: forbidden" } });
    expect(html).toContain("Ανοιχτά προβλήματα");
    expect(html).toContain("Συνήθης παραγγελία");
    expect(html).toContain("Δεν έγινε: forbidden");
  });

  it("shows account details from account-get, and a contained error when it fails", () => {
    const ok = card(miltosCard(), "en", {
      details: { status: "ready", value: { account: { phone: "+302106000000", email: "info@miltos.example.gr", street: "Odos 10", postal_code: "15231" }, contacts: [], deals: [{ id: "d1", title: "Espresso 20kg monthly", stage_code: "negotiation", amount_minor: 380000, closed_at: null }], activities: [] } },
    });
    expect(ok).toContain('href="tel:+302106000000"');
    expect(ok).toContain("Espresso 20kg monthly");
    expect(card(miltosCard(), "en", { details: { status: "error", message: "timeout" } })).toContain("Could not load account details");
  });
});

describe("account list view", () => {
  it("lists accounts with type badges in Greek", () => {
    const html = list({ status: "ready", items: [miltosCard().account, avraCard().account], total: 2 });
    expect(html).toContain("Πελάτες");
    expect(html).toContain("2 λογαριασμοί");
    expect(html).toContain("Café Avra");
    expect(html).toContain("Υποψήφιος");
  });

  it("has loading, empty, no-results and error states", () => {
    expect(list({ status: "loading" })).toContain('aria-busy="true"');
    expect(list({ status: "ready", items: [], total: 0 })).toContain("Κανένας λογαριασμός");
    expect(list({ status: "ready", items: [], total: 0 }, "zzz", "en")).toContain("Nothing matches “zzz”");
    expect(list({ status: "error", message: "upstream_failed: boom" }, "", "en")).toContain("Could not load accounts");
  });
});
