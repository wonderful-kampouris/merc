import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addDays, defineFunction, runAsTool, today, validateResponse, weekRange } from "../../core/src/index";
import type { ModelFactory } from "../../llm/src/index";
import { kit, ok, errCode, USERS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, impl } from "../src/candidate-act";
import { handle as list } from "../src/candidates-list";
import { handle as saveDossier } from "../src/dossier-save";
import { makeImpl as searchImpl } from "../src/prospect-search";

const model: ModelFactory = () => ({ withStructuredOutput: () => ({ invoke: async (m: any[]) => ({ ratings: [{ criterion: "category_fit", rating: JSON.parse(m[1].content).dossier.summary.includes("Ble") ? 1 : 0.3, reason: "fit" }] }) }) });
async function setup() {
  const t = kit();
  const s = ok(await defineFunction("prospect-search", searchImpl({ fetch: async () => { throw new Error("x"); }, model }))(t.fnCtx("nikos", { area_text: "Chalandri", category_text: "bakery", origin: "manual" })));
  const items = ok(await list(t.fnCtx("nikos", { search_id: s.search_id }))).items;
  return { t, items, top: items[0]!, dup: items.find((c) => c.status === "duplicate")! };
}

describe("fn:candidate-act (REQ-PRS-006)", () => {
  it("add_to_route: prospect account, dossier moved, visit this week; the top J4 bakery is in the week's plan", async () => {
    const { t, top } = await setup();
    expect(top.business_name).toBe("Ble Fournos");
    const d = ok(await saveDossier(t.fnCtx(null, { candidate_id: top.candidate_id, summary: "Bakery with café corner", facts: [{ fact_type: "product", value: "Sourdough", source_url: "https://blefournos.example.gr" }] })));
    const r = ok(await handle(t.fnCtx("nikos", { candidate_id: top.candidate_id, action: "add_to_route" })));
    expect(validateResponse("candidate-act", r).ok).toBe(true);
    const org = (await t.principal("nikos")).org;
    expect(await t.db.account.get(r.account_id!)).toMatchObject({ name: "Ble Fournos", account_type: "prospect", source: "prospecting", owner_rep_id: USERS.nikos, territory_id: "76b55561-9135-5c55-ad43-34661bffd9d9", postal_code: "15231", vat_number: "900001212", category_id: "10169ea8-bbde-567f-93b2-d5686ea70ef4" });
    const v = (await t.db.visit.get(r.visit_id!))!;
    const wk = weekRange(org, today(org));
    expect(v).toMatchObject({ account_id: r.account_id, rep_id: USERS.nikos, status: "planned", origin: "manual", planned_date: today(org) });
    expect(v.planned_date >= wk.fromDate && v.planned_date <= wk.toDate).toBe(true);
    expect((await t.db.dossier.get(d.dossier_id))!.account_id).toBe(r.account_id);
    expect(r.candidate).toMatchObject({ status: "added", assigned_rep: { id: USERS.nikos, role: "rep" } });
    const again = ok(await handle(t.fnCtx("nikos", { candidate_id: top.candidate_id, action: "add_to_route" })));
    expect([again.account_id, again.visit_id]).toEqual([r.account_id, r.visit_id]);
    expect(errCode(await handle(t.fnCtx("nikos", { candidate_id: top.candidate_id, action: "dismiss" })))).toBe("conflict");
  });

  it("assign: reps cannot assign to others; the manager's default is the territory's default rep", async () => {
    const { t, items } = await setup();
    const c = items[1]!;
    expect(errCode(await handle(t.fnCtx("nikos", { candidate_id: c.candidate_id, action: "assign", rep_id: USERS.dimitra })))).toBe("forbidden");
    const r = ok(await handle(t.fnCtx("eleni", { candidate_id: c.candidate_id, action: "assign" })));
    expect(r.candidate.assigned_rep?.id).toBe(USERS.nikos);
    const m = ok(await handle(t.fnCtx("eleni", { candidate_id: c.candidate_id, action: "add_to_route", rep_id: USERS.dimitra, date: addDays(today((await t.principal("eleni")).org), 1) })));
    expect((await t.db.visit.get(m.visit_id!))).toMatchObject({ rep_id: USERS.dimitra, origin: "manager" });
  });

  it("dismiss, duplicates, past dates, scope, identity and the tool path", async () => {
    const { t, items, dup } = await setup();
    expect(ok(await handle(t.fnCtx("nikos", { candidate_id: items[2]!.candidate_id, action: "dismiss" }))).candidate.status).toBe("dismissed");
    expect(errCode(await handle(t.fnCtx("nikos", { candidate_id: dup.candidate_id, action: "add_to_route" })))).toBe("conflict");
    expect(errCode(await handle(t.fnCtx("nikos", { candidate_id: items[3]!.candidate_id, action: "add_to_route", date: "2020-01-01" })))).toBe("validation_failed");
    const center = await t.db.prospect_search.insert({ requested_by: USERS.eleni, area_text: "Kolonaki", origin: "manual", status: "done" } as any);
    const hidden = await t.db.candidate.insert({ search_id: center.id, business_name: "Kolonaki Bakes", postal_code: "10673", external_source: "rep", status: "new" } as any);
    expect(errCode(await handle(t.fnCtx("nikos", { candidate_id: hidden.id, action: "dismiss" })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx(null, { candidate_id: items[3]!.candidate_id, action: "dismiss" })))).toBe("forbidden");
    const viaTool = ok(await runAsTool("candidate-act", impl, t.toolCtx("nikos"), { candidate_id: items[4]!.candidate_id, action: "add_to_route" }, t.key));
    expect(viaTool.visit_id).toBeTruthy();
  });

  it("functions/candidate-act/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "candidate-act", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("candidate-act"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
