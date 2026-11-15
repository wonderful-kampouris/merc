import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { mockResult, type ApprovalCard } from "../../../contracts";
import { createClient } from "../../../lib/client";
import { I18nProvider, translateScreen, type Lang } from "../../../lib/i18n";
import { findScreen } from "../../../lib/routes";
import ApprovalItem from "./ApprovalItem";
import messages from "./i18n";
import Screen from "./index";

vi.mock("@wonderful/ui-base", () => import("./testkit/uiStub"));

const html = (lang: Lang, el: ReactElement) => renderToStaticMarkup(createElement(I18nProvider, { lang, children: el }));
const t = (lang: Lang) => (k: string, v?: Record<string, string | number>) => translateScreen(messages, lang, k, v);
const base = mockResult("manager-approvals-list").items[0]!;
const discount: ApprovalCard = {
  ...base,
  kind: "discount",
  status: "pending",
  mode: "live",
  requested_pct: 8,
  policy_limit_pct: 5,
  preview: "Lofos asks 8% on the Christmas order",
  account: { id: base.account!.id, name: "Lofos Bakery", account_type: "customer" },
  requested_by: { ...base.requested_by, full_name: "Nikos Alexiou" },
  due_at: "2026-11-16T09:50:00Z",
};
const NOW = new Date("2026-11-16T10:00:00Z");

describe("approval card component", () => {
  it("renders a pending discount with one-tap approve, counter and reject, in Greek by default", () => {
    const out = html("el", createElement(ApprovalItem, { card: discount, lang: "el", t: t("el"), now: NOW, onDecide: () => undefined }));
    expect(out).toContain("Lofos Bakery");
    expect(out).toContain("Έγκριση 8%");
    expect(out).toContain("Αντιπρόταση");
    expect(out).toContain("Απόρριψη");
    expect(out).toContain("Ο πωλητής είναι σε κλήση");
    expect(out).toContain("Καθυστέρηση 10 λεπτά");
    expect(out).toContain("Από Nikos Alexiou");
  });

  it("renders English", () => {
    const out = html("en", createElement(ApprovalItem, { card: discount, lang: "en", t: t("en"), now: NOW, onDecide: () => undefined }));
    expect(out).toContain("Approve 8%");
    expect(out).toContain("Rep on a call");
    expect(out).toContain("Overdue 10 min");
  });

  it("a decided card has no action buttons and shows the approved %", () => {
    const done = { ...discount, status: "countered" as const, approved_pct: 6 };
    const out = html("en", createElement(ApprovalItem, { card: done, lang: "en", t: t("en"), result: "Nikos Alexiou was notified.", onDecide: () => undefined }));
    expect(out).toContain("Countered");
    expect(out).toContain("6%");
    expect(out).toContain("Nikos Alexiou was notified.");
    expect(out).not.toContain("Approve 8%");
  });

  it("a customer message has approve/reject but no counter", () => {
    const msg = { ...discount, kind: "customer_message" as const, subject: "Offer", recipient: "lofos@example.com", body: "Dear..." };
    const out = html("en", createElement(ApprovalItem, { card: msg, lang: "en", t: t("en"), onDecide: () => undefined }));
    expect(out).toContain(">Approve<");
    expect(out).not.toContain(">Counter<");
    expect(out).toContain("lofos@example.com");
  });

  it("shows a decision error", () => {
    const out = html("en", createElement(ApprovalItem, { card: discount, lang: "en", t: t("en"), error: "This request was already decided.", onDecide: () => undefined }));
    expect(out).toContain("This request was already decided.");
  });

  it("the screen first renders its loading state", () => {
    const screen = findScreen("/mgmt/approvals")!;
    const client = createClient({ mock: true, invoker: { invokeFunction: () => Promise.reject(new Error("x")) } }).forScreen(screen.functions);
    const out = html("el", createElement(Screen, { screen, client, navigate: () => undefined, lang: "el" }));
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("Εγκρίσεις");
  });
});
