import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { mockResult, validateRequest } from "../../../contracts";
import { createClient } from "../../../lib/client";
import { I18nProvider, translateScreen } from "../../../lib/i18n";
import { findScreen } from "../../../lib/routes";
import { AssignTask, AssignVisit } from "./AssignForms";
import messages from "./i18n";
import Screen from "./index";
import {
  accountOptions,
  detailRange,
  dueAt,
  humanize,
  isoDay,
  kpiEntries,
  rosterFromTeam,
  sortAlerts,
  taskAssignRequest,
  teamRoster,
  tomorrow,
  validateTask,
  validateVisit,
  visitAssignRequest,
} from "./logic";

vi.mock("@wonderful/ui-base", () => import("../approvals/testkit/uiStub"));

const ELENI = "fa4c7746-c253-5104-a735-7060bfddb756";
const DIMITRA = "a3ecd990-28ac-57dd-9d89-c5e5afb1f68c";
const screen = findScreen("/mgmt/team")!;
const mockClient = () => createClient({ mock: true, invoker: { invokeFunction: () => Promise.reject(new Error("no platform")) } }).forScreen(screen.functions);

describe("team logic", () => {
  it("roster from team-list: active reps only, sorted by name", () => {
    const m = (id: string, full_name: string, role: "rep" | "manager" = "rep", status = "active") => ({ user: { id, full_name, role }, manager_id: ELENI, territory_ids: [], status });
    const r = rosterFromTeam([m("3", "Zeta"), m("1", "Alpha"), m("2", "Eleni", "manager"), m("4", "Old", "rep", "inactive")]);
    expect(r.map((x) => x.full_name)).toEqual(["Alpha", "Zeta"]);
  });

  it("fallback roster: the seeded reps, Dimitra included, filterable by manager", () => {
    const all = teamRoster();
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.every((r) => r.role === "rep")).toBe(true);
    expect(teamRoster(ELENI).map((r) => r.id)).toContain(DIMITRA);
    expect(teamRoster("00000000-0000-4000-8000-000000000000")).toEqual([]);
  });

  it("dates are org-timezone days", () => {
    const late = new Date("2026-11-15T22:30:00Z"); // 00:30 in Athens on the 16th
    expect(isoDay(late)).toBe("2026-11-16");
    expect(detailRange(late)).toEqual({ from: "2026-11-03", to: "2026-11-16" });
    expect(tomorrow(late)).toBe("2026-11-17");
    expect(dueAt("2026-11-20")).toBe("2026-11-20T16:00:00.000Z"); // 18:00 EET
    expect(dueAt("2026-07-20")).toBe("2026-07-20T15:00:00.000Z"); // 18:00 EEST
  });

  it("visit form: validation and a contract-valid visit-assign body", () => {
    const today = "2026-11-16";
    expect(validateVisit({ account_id: null, date: today, purpose: "" }, today)).toBe("account_required");
    expect(validateVisit({ account_id: "a", date: "", purpose: "" }, today)).toBe("date_required");
    expect(validateVisit({ account_id: "a", date: "2026-11-15", purpose: "" }, today)).toBe("date_past");
    const acc = mockResult("rep-detail", { rep_id: DIMITRA, from: today, to: today }).recent_visits[0]!.account.id;
    const f = { account_id: acc, date: "2026-11-17", purpose: " Christmas stock " };
    expect(validateVisit(f, today)).toBeNull();
    const body = visitAssignRequest(DIMITRA, f);
    expect(body).toEqual({ rep_id: DIMITRA, account_id: acc, date: "2026-11-17", purpose: "Christmas stock" });
    expect(validateRequest("visit-assign", body).ok).toBe(true);
    expect(visitAssignRequest(DIMITRA, { ...f, purpose: "" })).not.toHaveProperty("purpose");
  });

  it("task form: validation and a contract-valid task-assign body", () => {
    expect(validateTask({ title: "  ", due: "", account_id: null })).toBe("title_required");
    expect(validateTask({ title: "x".repeat(201), due: "", account_id: null })).toBe("title_too_long");
    expect(validateTask({ title: "Call", due: "16/11", account_id: null })).toBe("due_invalid");
    const body = taskAssignRequest(DIMITRA, { title: " Call Lofos ", due: "2026-11-20", account_id: null });
    expect(body).toEqual({ rep_id: DIMITRA, title: "Call Lofos", due_at: "2026-11-20T16:00:00.000Z" });
    expect(validateRequest("task-assign", body).ok).toBe(true);
  });

  it("account options merge rep visits, rep alerts and team alerts without duplicates", () => {
    const d = mockResult("rep-detail", { rep_id: DIMITRA, from: "2026-11-01", to: "2026-11-16" });
    const alerts = mockResult("alerts-list", { scope: "team" }).items;
    const opts = accountOptions(d, alerts);
    expect(new Set(opts.map((o) => o.id)).size).toBe(opts.length);
    expect(opts.length).toBeGreaterThan(0);
    expect(accountOptions(null)).toEqual([]);
  });

  it("kpis: numbers and strings only, labelled", () => {
    expect(kpiEntries({ visits_done: 12, note: "ok", nested: { a: 1 }, none: null })).toEqual([
      { key: "visits_done", value: 12 },
      { key: "note", value: "ok" },
    ]);
    expect(humanize("visits_done")).toBe("Visits done");
  });

  it("alerts sorted by severity, then newest", () => {
    const a = mockResult("alerts-list").items[0]!;
    const xs = [
      { ...a, alert_id: "1", severity: "low" as const },
      { ...a, alert_id: "2", severity: "high" as const, created_at: "2026-11-10T09:00:00Z" },
      { ...a, alert_id: "3", severity: "high" as const, created_at: "2026-11-12T09:00:00Z" },
    ];
    expect(sortAlerts(xs).map((x) => x.alert_id)).toEqual(["3", "2", "1"]);
  });

  it("calls only the screen's app.json functions, all of them answer in mock mode", async () => {
    expect(screen.functions).toEqual(["team-list", "rep-detail", "alerts-list", "visit-assign", "task-assign"]);
    const c = mockClient();
    const roster = rosterFromTeam((await c.call("team-list", {})).items);
    expect(roster.length).toBeGreaterThan(0);
    const d = await c.call("rep-detail", { rep_id: DIMITRA, ...detailRange() });
    expect(d.rep.full_name).toBe("Dimitra Pappa");
    await c.call("alerts-list", { status: "open", scope: "team", limit: 20 });
    const v = await c.call("visit-assign", visitAssignRequest(DIMITRA, { account_id: d.recent_visits[0]!.account.id, date: tomorrow(), purpose: "" }));
    expect(v.visit.visit_id).toBeTruthy();
    const task = await c.call("task-assign", taskAssignRequest(DIMITRA, { title: "Call Lofos", due: "", account_id: null }));
    expect(task.task_id).toBeTruthy();
    await expect(c.call("users-list" as never, {} as never)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("team components", () => {
  const rep = { id: DIMITRA, full_name: "Dimitra Pappa", role: "rep" as const };
  const accounts = [{ id: "59b5e454-cc4b-5fab-939b-a50c78e8aa9b", name: "Café Miltos", account_type: "customer" as const }];
  const tr = (lang: "el" | "en") => (k: string, v?: Record<string, string | number>) => translateScreen(messages, lang, k, v);

  it("assign forms render in Greek and English", () => {
    const el = renderToStaticMarkup(createElement(AssignVisit, { rep, accounts, client: mockClient(), t: tr("el"), today: "2026-11-16" }));
    expect(el).toContain("Ανάθεση επίσκεψης σε Dimitra Pappa");
    const en = renderToStaticMarkup(createElement(AssignTask, { rep, accounts, client: mockClient(), t: tr("en") }));
    expect(en).toContain("Assign task to Dimitra Pappa");
  });

  it("the screen first renders the title while team-list loads", () => {
    const out = renderToStaticMarkup(createElement(I18nProvider, { lang: "el", children: createElement(Screen, { screen, client: mockClient(), navigate: () => undefined, lang: "el" }) }));
    expect(out).toContain("Ομάδα");
    expect(out).toContain("ui-skeleton");
  });
});
