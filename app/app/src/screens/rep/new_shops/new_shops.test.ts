import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { CandidateCard } from "../../../contracts";
import { checkScreenMessages } from "../../../lib/i18n";
import { createScreenTestClient } from "../approvals/kit/testClient";
import { getText, renderForTest } from "../approvals/kit/renderForTest";
import messages from "./i18n";
import { canAdd, createAddBody, createSearchBody, EMPTY_ADD, getHost, getReady, getVisible } from "./logic";

vi.mock("@wonderful/ui-base", () => import("../approvals/kit/uiStub"));
const { default: NewShopsView } = await import("./NewShopsView");

const cand = (over: Partial<CandidateCard> = {}): CandidateCard => ({
  candidate_id: "08dffdee-5b37-4fb9-8dcd-650830ff0973",
  business_name: "Fournos Chalandri",
  status: "scored",
  postal_code: "15231",
  website: "https://www.fournos-chalandri.gr",
  score: 86.4,
  reasons: ["Near your Thursday route", "Bakery with coffee corner"],
  dossier: {
    summary: "Family bakery, opened 2019, coffee to go.",
    price_level: "mid",
    facts: [{ fact_type: "hours", value: "Open 6:30-21:00", source_url: "https://www.fournos-chalandri.gr/contact", retrieved_at: "2026-11-15T08:00:00Z" }],
    competitor_brands: ["Aroma"],
  },
  duplicate_of: null,
  assigned_rep: null,
  ...over,
});
const noop = () => {};
const props = (over: Partial<Parameters<typeof NewShopsView>[0]> = {}): Parameters<typeof NewShopsView>[0] => ({
  state: { status: "ready", data: [cand()], refreshing: false },
  busy: {},
  feedback: null,
  search: { area: "", category: "", busy: false, search: null, filtered: false, onArea: noop, onCategory: noop, onSearch: noop, onShowResults: noop, onShowAll: noop },
  add: { open: false, form: EMPTY_ADD, busy: false, onOpen: noop, onChange: noop, onSubmit: noop },
  onRetry: noop,
  onAct: noop,
  onOpenWeek: noop,
  onDismissFeedback: noop,
  ...over,
});

describe("rep new shops logic", () => {
  it("builds search and add bodies, rejecting empty input", () => {
    expect(createSearchBody("  ", "x")).toBeNull();
    expect(createSearchBody(" Chalandri ", "")).toEqual({ area_text: "Chalandri", category_text: null, origin: "manual" });
    expect(createAddBody({ ...EMPTY_ADD, name: "New bakery", location: "next to Miltos" })).toEqual({ business_name: "New bakery", location_hint: "next to Miltos", website: null, phone: null });
    expect(createAddBody(EMPTY_ADD)).toBeNull();
  });

  it("best score first, dismissed hidden; duplicates cannot be added", () => {
    const list = getVisible([cand({ candidate_id: "a", score: 40 }), cand({ candidate_id: "b", score: 90 }), cand({ candidate_id: "c", status: "dismissed" }), cand({ candidate_id: "d", score: null })]);
    expect(list.map((c) => c.candidate_id)).toEqual(["b", "a", "d"]);
    expect(canAdd(cand({ duplicate_of: { id: "59b5e454-cc4b-5fab-939b-a50c78e8aa9b", name: "Miltos", account_type: "customer" } }))).toBe(false);
    expect(getHost("https://www.fournos.gr/x")).toBe("fournos.gr");
    expect(getReady({ type: "candidates.ready", at: "", payload: { search_id: "s", found: 18, duplicates: 5, scored: 13 } })).toEqual({ searchId: "s", found: 18, duplicates: 5, scored: 13 });
  });

  it("search, add and add-to-route run through the contract mocks (REQ-PRS-006)", async () => {
    const { client, calls } = createScreenTestClient("/rep/new-shops");
    const s = await client.call("prospect-search", createSearchBody("Chalandri", "bakeries")!);
    const list = await client.call("candidates-list", { search_id: s.search_id, limit: 50 });
    const r = await client.call("candidate-act", { candidate_id: list.items[0]!.candidate_id, action: "add_to_route", date: null });
    expect(r.candidate.candidate_id).toMatch(/-/);
    await client.call("candidate-add", createAddBody({ ...EMPTY_ADD, name: "New bakery" })!);
    expect(calls).toEqual(["prospect-search", "candidates-list", "candidate-act", "candidate-add"]);
  });
});

describe("rep new shops view", () => {
  it("dictionary is complete", () => expect(checkScreenMessages(messages)).toEqual([]));

  it("shows score, reasons, dossier facts with source and actions", () => {
    const en = getText(renderForTest(h(NewShopsView, props()), "en"));
    expect(en).toContain("Fournos Chalandri");
    expect(en).toContain("Score 86");
    expect(en).toContain("• Near your Thursday route");
    expect(en).toContain("Source: fournos-chalandri.gr");
    expect(en).toContain("Uses: Aroma");
    expect(en).toContain("Add to my route");
    const el = getText(renderForTest(h(NewShopsView, props())));
    expect(el).toContain("Προσθήκη στη διαδρομή");
    expect(el).toContain("Αναζήτηση νέων καταστημάτων");
  });

  it("search progress, add form and week link", () => {
    const running = props({ search: { ...props().search, area: "Chalandri", search: { searchId: "s", area: "Chalandri" } } });
    expect(getText(renderForTest(h(NewShopsView, running), "en"))).toContain("Searching Chalandri");
    const ready = props({ search: { ...props().search, search: { searchId: "s", area: "Chalandri", ready: { searchId: "s", found: 18, duplicates: 5, scored: 13 } } } });
    expect(getText(renderForTest(h(NewShopsView, ready), "en"))).toContain("18 found · 5 already known · 13 scored");
    const add = getText(renderForTest(h(NewShopsView, props({ add: { ...props().add, open: true } })), "en"));
    expect(add).toContain("Shop name");
    expect(add).toContain("Add shop");
    expect(getText(renderForTest(h(NewShopsView, props({ feedback: { kind: "success", text: "ok", week: true } })), "en"))).toContain("Open week");
  });

  it("loading, empty, error", () => {
    expect(renderForTest(h(NewShopsView, props({ state: { status: "loading" } })))).toContain("ui-skeleton-text");
    expect(getText(renderForTest(h(NewShopsView, props({ state: { status: "ready", data: [], refreshing: false } })), "en"))).toContain("No new shops yet");
    expect(getText(renderForTest(h(NewShopsView, props({ state: { status: "error", error: new Error("x") } })), "en"))).toContain("Try again");
  });
});
