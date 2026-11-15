import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateResponse } from "../../core/src/index";
import { llmContract } from "../../llm/src/index";
import { handle, impl, keywordRoute, makeImpl, TEMPLATES, type Route, type Router } from "../src/ask-crm";
import { kit, ok, errCode, IDS, DEMO_DAY } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS, ROOT } from "../src/_lib/bundle";

const NOW = Date.parse(`${DEMO_DAY}T10:00:00Z`);
const LOFOS = "24d14591-c8c2-5885-819a-c5e997f6cad0", KOLONAKI = "4cfe45a4-9761-5595-adb2-c1af5a6f2329";
const LOFOS_LAST_ORDER = "3e02b408";

/** A router that answers like the model would, and records what it was asked. */
function fixed(route: Partial<Route> & { template: Route["template"] }) {
  const seen: unknown[] = [];
  const r: Router = async (input) => { seen.push(input); return { route: { params: {}, confidence: 0.9, ...route } as Route, router: "llm" }; };
  return { r, seen };
}
const ask = (t: ReturnType<typeof kit>, route: Router, who: "nikos" | "dimitra" | "eleni" | "thanasis", params: Record<string, unknown>) =>
  runAsTool("ask-crm", makeImpl({ route, now: () => NOW }), t.toolCtx(who), params, t.key);

const CASES = JSON.parse(readFileSync(join(ROOT, "evals/ask-crm/cases.json"), "utf8")) as { cases: Array<{ id: string; question: string; template: Route["template"]; account_hint?: string; product_hint?: string; seed_fact?: string; keyword?: boolean }> };

describe("fn:ask-crm (REQ-CRD-004)", () => {
  it('"When did Lofos last order?" returns the seeded date, from the sales_order row', async () => {
    const t = kit();
    const m = fixed({ template: "last_order", params: { account_hint: "Lofos" } });
    const r = ok(await ask(t, m.r, "nikos", { question: "When did Lofos last order?" }));
    expect(validateResponse("ask-crm", r).ok).toBe(true);
    expect(m.seen[0]).toEqual({ question: "When did Lofos last order?", account_id: null, today: "2026-11-16" });
    expect(r.template).toBe("last_order");
    expect(r.no_data).toBe(false);
    expect(r.params.account_id).toBe(LOFOS);
    const date = r.facts.find((f) => f.label.endsWith("last order date"))!;
    expect(date.value).toBe("2026-11-04"); // seed @D-12
    expect(date.source).toMatch(new RegExp(`^sales_order:${LOFOS_LAST_ORDER}`));
    expect(r.facts.find((f) => f.label.endsWith("days since last order"))!.value).toBe("12");
  });

  it("an off-template question returns no_data with no facts, so the buddy says it doesn't know", async () => {
    const t = kit();
    const r = ok(await ask(t, fixed({ template: "unknown", confidence: 0.1 }).r, "nikos", { question: "What's the weather tomorrow?" }));
    expect(r).toEqual({ template: "unknown", params: { router: "llm", confidence: 0.1 }, facts: [], no_data: true });
    // A low-confidence template is also treated as unknown.
    const low = ok(await ask(t, fixed({ template: "last_order", confidence: 0.2, params: { account_hint: "Lofos" } }).r, "nikos", { question: "Lofos?" }));
    expect(low.template).toBe("unknown");
    expect(low.facts).toEqual([]);
  });

  it("without the model runtime the keyword fallback still answers the acceptance questions", async () => {
    const t = kit();
    const viaDefault = (q: string) => runAsTool("ask-crm", impl, t.toolCtx("nikos"), { question: q }, t.key);
    const lofos = ok(await viaDefault("When did Lofos last order?"));
    expect(lofos.params.router).toBe("keywords");
    expect(lofos.facts.find((f) => f.label.endsWith("last order date"))!.value).toBe("2026-11-04");
    const price = ok(await viaDefault("How much is Espresso Nuovo?"));
    expect(price.template).toBe("price_of_product");
    expect(price.facts[0]).toMatchObject({ value: "21.50", source: "product:b28bc378-ec47-55d6-a414-b09ac0dacc3d" });
    expect(ok(await viaDefault("Is the owner of Lofos married?")).no_data).toBe(true);
  });

  it("scope (REQ-CORE-009): another rep's account id is forbidden; another territory's name is not resolved", async () => {
    const t = kit();
    const m = fixed({ template: "last_order" });
    expect(errCode(await ask(t, m.r, "nikos", { question: "last order?", account_id: KOLONAKI }))).toBe("forbidden");
    expect(m.seen).toHaveLength(0); // scope checked before the model is asked
    const byName = ok(await ask(t, fixed({ template: "last_order", params: { account_hint: "Kolonaki Corner" } }).r, "nikos", { question: "When did Kolonaki Corner last order?" }));
    expect(byName).toMatchObject({ no_data: true, facts: [] });
    expect(byName.params.account_id).toBeNull();
    // The admin sees it.
    expect(ok(await ask(t, fixed({ template: "last_order" }).r, "thanasis", { question: "last order?", account_id: KOLONAKI })).no_data).toBe(false);
  });

  it("every template runs on the seed, returns contract-valid facts with row sources", async () => {
    const t = kit();
    const want: Record<string, { account?: string; hint?: string; product?: string; from?: string }> = {
      last_order: { account: LOFOS }, order_history_product: { account: LOFOS, product: "Espresso Classico" }, open_items: { account: LOFOS },
      account_overview: { account: IDS.miltos }, deal_status: { account: LOFOS }, visit_history: { account: LOFOS },
      competitor_mentions: {}, top_products: { account: IDS.miltos }, price_of_product: { product: "Greek Coffee" },
    };
    for (const tpl of TEMPLATES.filter((x) => x !== "unknown")) {
      const w = want[tpl]!;
      const r = ok(await ask(t, fixed({ template: tpl, params: { product_hint: w.product ?? null } }).r, "nikos", { question: "q", account_id: w.account ?? null }));
      expect(validateResponse("ask-crm", r).ok, tpl).toBe(true);
      expect(r.no_data, tpl).toBe(false);
      expect(r.facts.length, tpl).toBeGreaterThan(0);
      for (const f of r.facts) expect(f.source, tpl).toMatch(/^[a-z_]+:[0-9a-f-]{8}/);
    }
  });

  it("open items, deals and visits for Lofos come from the rows", async () => {
    const t = kit();
    const items = ok(await ask(t, fixed({ template: "open_items" }).r, "nikos", { question: "q", account_id: LOFOS })).facts;
    expect(items.map((f) => f.label)).toEqual(expect.arrayContaining(["open task: Bistro Lofos offer expires - follow up", "open deal: Q4 coffee offer"]));
    const deal = ok(await ask(t, fixed({ template: "deal_status" }).r, "nikos", { question: "q", account_id: LOFOS })).facts[0]!;
    expect(deal.value).toContain("stage proposal, 2400.00 EUR");
    const visits = ok(await ask(t, fixed({ template: "visit_history", params: { limit: 2 } }).r, "nikos", { question: "q", account_id: LOFOS })).facts;
    expect(visits.map((f) => f.label)).toEqual(["visit on 2026-11-03", "visit on 2026-10-25"]);
  });

  it("a spoofed caller is ignored; no user -> forbidden; deployed entry matches the tool path", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx(null, { question: "x" })))).toBe("forbidden");
    const m = fixed({ template: "last_order" });
    const h = makeImpl({ route: m.r, now: () => NOW });
    const spoof = await runAsTool("ask-crm", h, t.toolCtx("nikos"), { question: "q", account_id: KOLONAKI, caller: { user_id: IDS.thanasis, role: "admin" } }, t.key);
    expect(errCode(spoof)).toBe("forbidden");
    expect(await runAsTool("ask-crm", impl, t.toolCtx("nikos"), { question: "When did Lofos last order?" }, t.key)).toEqual(ok(await handle(t.fnCtx("nikos", { question: "When did Lofos last order?" }))));
  });

  it("eval set evals/ask-crm: templates in the contract enum; keyword cases route right; seed facts hold", async () => {
    const enumT = (llmContract("ask_crm_route").output as any).properties.template.enum as string[];
    expect([...TEMPLATES].sort()).toEqual([...enumT].sort());
    expect(CASES.cases.length).toBeGreaterThanOrEqual(20);
    expect(CASES.cases.some((c) => c.template === "unknown")).toBe(true);
    const t = kit();
    for (const c of CASES.cases) {
      expect(enumT, c.id).toContain(c.template);
      if (c.keyword) expect(keywordRoute(c.question).template, c.id).toBe(c.template);
      if (c.seed_fact) {
        const r = ok(await ask(t, fixed({ template: c.template, params: { account_hint: c.account_hint ?? null, product_hint: c.product_hint ?? null } }).r, "nikos", { question: c.question }));
        expect(r.facts.map((f) => f.value), c.id).toContain(c.seed_fact);
      }
    }
  });

  it("functions/ask-crm/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "ask-crm", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("ask-crm"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
