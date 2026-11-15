import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsTool, validateResponse } from "../../core/src/index";
import { validateSchema, llmContract, defSchemas } from "../../llm/src/index";
import {
  computeMetrics, fitSpoken, kbFromApi, makeImpl, usualItems, MAX_SPOKEN_WORDS,
  type CardDeps, type PitchInput, type PitchOutput,
} from "../src/visit-card-get";
import { kit, ok, errCode, IDS, DEMO_DAY } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const AVRA = "ef86a932-3241-51c8-b7be-1df72dbf74f9";
const NUOVO = "b28bc378-ec47-55d6-a414-b09ac0dacc3d";
const CLASSICO = "120d56dc-215d-557d-bbab-43d87e1047c4";
const NOW = Date.parse(`${DEMO_DAY}T08:00:00Z`);

const goodPitch = (input: PitchInput): PitchOutput => ({
  pitch: input.kind === "prospect" ? {
    opening_line: "Your brunch is loved; how is the coffee at peak?",
    arguments: ["Reviews mention slow coffee at peak.", "One supplier, one delivery.", "A 1 kg trial bag this week."],
    products: [{ product_id: NUOVO, name: "whatever the model says", why: "Campaign product" }],
    objections: [{ objection: "We are happy with BlueBean.", answer: "Try it side by side for a week." }],
  } : null,
  how_to_talk: "Be brief, talk to Miltos directly, start with the grinder.",
  suggested_products: [{ product_id: NUOVO, why: "Espresso Nuovo campaign" }, { product_id: "00000000-0000-4000-8000-000000000000", why: "invented" }],
});

function deps(over: Partial<CardDeps> = {}) {
  const calls: { pitch: PitchInput[]; kb: Array<[string, string]>; logs: string[] } = { pitch: [], kb: [], logs: [] };
  const d: CardDeps = {
    pitch: async (input) => { calls.pitch.push(input); return { ok: true, value: goodPitch(input), attempts: 1, profile: "p", logs: [] }; },
    kb: async (name, q) => { calls.kb.push([name, q]); return [`${name} passage`]; },
    now: () => NOW,
    log: (m) => calls.logs.push(m),
    ...over,
  };
  return { d, calls };
}
const run = (t: ReturnType<typeof kit>, d: CardDeps, who: "nikos" | "eleni" | "dimitra" | "thanasis" | null, body: unknown) =>
  defineFunction("visit-card-get", makeImpl(d))(t.fnCtx(who, body));

describe("fn:visit-card-get customer card (REQ-CRD-001)", () => {
  it("Café Miltos: grinder problem, 12 kg usual order, contacts, orders, metrics, campaign, spoken summary <= 30 s", async () => {
    const t = kit(); const { d, calls } = deps();
    const r = ok(await run(t, d, "nikos", { account_id: IDS.miltos }));
    expect(validateResponse("visit-card-get", r).ok).toBe(true);
    expect(r.kind).toBe("customer");
    expect(r.account).toMatchObject({ id: IDS.miltos, name: "Café Miltos", account_type: "customer" });
    expect(r.contacts[0]).toMatchObject({ full_name: "Miltos Papadakis", is_decision_maker: true });
    expect(r.open_problems.map((p) => p.description)).toContain("Grinder is making noise");
    expect(r.recent_orders).toHaveLength(5);
    expect(r.recent_orders[0]!.order_date).toBe("2026-11-10");
    expect(r.recent_orders[0]!.total_minor).toBe(8 * 320 + 6 * 1250);
    expect(r.metrics.days_since_last_order).toBe(6);
    expect(r.metrics.avg_order_interval_days).toBeGreaterThan(5);
    expect(Array.isArray(r.metrics.risk_reasons)).toBe(true);
    expect(r.campaigns.map((c) => c.title)).toContain("Espresso Nuovo to cafés");
    expect(r.suggested_products).toEqual([{ product_id: NUOVO, name: "Espresso Nuovo Blend 1kg", why: "Espresso Nuovo campaign" }]);
    expect(r.how_to_talk).toMatch(/grinder/);
    expect(r.spoken_summary).toMatch(/Grinder is making noise/);
    expect(r.spoken_summary).toMatch(/12 kg of Espresso Classico/);
    expect(r.spoken_summary.split(/\s+/).length).toBeLessThanOrEqual(MAX_SPOKEN_WORDS);
    // the LLM got code facts and KB passages, and only real products
    const input = calls.pitch[0]!;
    expect(validateSchema(llmContract("visit_card_pitch").input, input, defSchemas)).toEqual([]);
    expect(input.history_facts).toContain("Usual order: 12 kg of Espresso Classico 1kg");
    expect(input.playbook_snippets).toEqual(["merc-playbook passage", "merc-catalog passage"]);
    expect(input.products[0]!.product_id).toBe(NUOVO);
    expect(calls.kb.map((k) => k[0]).sort()).toEqual(["merc-catalog", "merc-playbook"]);
  });

  it("records campaign_exposure `shown` once per day, however often the card is opened", async () => {
    const t = kit(); const { d } = deps();
    const count = async () => (await t.db.campaign_exposure.all({ account_id: IDS.miltos, rep_id: IDS.nikos, stage: "shown" })).length;
    const before = await count();
    ok(await run(t, d, "nikos", { account_id: IDS.miltos }));
    ok(await run(t, d, "nikos", { account_id: IDS.miltos }));
    expect(await count()).toBe(before + 1);
  });

  it("uses the tbl:account_metrics row when the rollup has written one", async () => {
    const t = kit(); const { d } = deps();
    await t.db.account_metrics.insert({ account_id: IDS.miltos, avg_order_interval_days: 7, days_since_last_order: 20, risk_score: 70, risk_reasons: "order_gap|competitor", computed_at: new Date(NOW).toISOString() } as any);
    const r = ok(await run(t, d, "nikos", { account_id: IDS.miltos }));
    expect(r.metrics).toEqual({ avg_order_interval_days: 7, days_since_last_order: 20, risk_score: 70, risk_reasons: ["order_gap", "competitor"] });
    expect(r.spoken_summary).toMatch(/Watch out: ordering less often than usual, a competitor was seen recently/);
  });

  it("degrades without the LLM and without Context Hub: deterministic suggestions and how-to-talk", async () => {
    const t = kit();
    const { d, calls } = deps({ pitch: async () => ({ ok: false, error: { code: "upstream_failed", message: "down" } as any, attempts: 2, profile: "p", logs: [] }), kb: async () => { throw new Error("kb down"); } });
    const r = ok(await run(t, d, "nikos", { account_id: IDS.miltos }));
    expect(r.pitch).toBeNull();
    expect(r.how_to_talk).toMatch(/Miltos Papadakis/);
    expect(r.suggested_products.map((p) => p.product_id)).toEqual(expect.arrayContaining([NUOVO, CLASSICO]));
    expect(r.suggested_products.find((p) => p.product_id === CLASSICO)!.why).toBe("Usual order: 12 kg of Espresso Classico 1kg");
    expect(calls.logs.join("\n")).toMatch(/visit_card_pitch failed \(upstream_failed\)/);
  });
});

describe("fn:visit-card-get prospect card (REQ-CRD-002)", () => {
  it("Café Avra: dossier facts with sources, BlueBean as competitor brand, pitch with exactly 3 arguments and objections", async () => {
    const t = kit(); const { d } = deps();
    const r = ok(await run(t, d, "nikos", { account_id: AVRA }));
    expect(validateResponse("visit-card-get", r).ok).toBe(true);
    expect(r.kind).toBe("prospect");
    expect(r.dossier!.competitor_brands).toContain("BlueBean Roasters");
    const brand = r.dossier!.facts.find((f) => f.fact_type === "brand")!;
    expect(brand).toMatchObject({ value: "BlueBean Roasters espresso", source_url: "https://cafeavra.example.gr/menu" });
    expect(r.dossier!.facts.every((f) => f.source_url.startsWith("https://"))).toBe(true);
    expect(r.pitch!.arguments).toHaveLength(3);
    expect(r.pitch!.objections[0]).toEqual({ objection: "We are happy with BlueBean.", answer: "Try it side by side for a week." });
    expect(r.pitch!.products).toEqual([{ product_id: NUOVO, name: "Espresso Nuovo Blend 1kg", why: "Campaign product" }]);
    expect(r.spoken_summary).toMatch(/BlueBean Roasters/);
    expect(r.spoken_summary.split(/\s+/).length).toBeLessThanOrEqual(MAX_SPOKEN_WORDS);
  });

  it("enforces exactly 3 arguments: 5 are cut to 3, 2 fall back to the deterministic pitch", async () => {
    const t = kit();
    const mk = (args: string[]): CardDeps["pitch"] => async (input) => ({ ok: true, attempts: 1, profile: "p", logs: [], value: { ...goodPitch(input), pitch: { ...goodPitch(input).pitch!, arguments: args } } });
    const five = ok(await run(t, deps({ pitch: mk(["a", "b", "c", "d", "e"]) }).d, "nikos", { account_id: AVRA }));
    expect(five.pitch!.arguments).toEqual(["a", "b", "c"]);
    const two = ok(await run(t, deps({ pitch: mk(["a", "b"]) }).d, "nikos", { account_id: AVRA }));
    expect(two.pitch!.arguments).toHaveLength(3);
    expect(two.pitch!.objections.map((o) => o.objection)).toContain("We are happy with BlueBean Roasters.");
  });

  it("LLM down: the prospect still gets a grounded 3-argument pitch with objections", async () => {
    const t = kit();
    const r = ok(await run(t, deps({ pitch: async () => { throw new Error("no ModelProfiles"); } }).d, "nikos", { account_id: AVRA }));
    expect(r.pitch!.arguments).toHaveLength(3);
    expect(r.pitch!.arguments[0]).toMatch(/slow coffee at peak/);
    expect(r.pitch!.objections.length).toBeGreaterThanOrEqual(2);
    expect(validateResponse("visit-card-get", r).ok).toBe(true);
  });
});

describe("fn:visit-card-get scope and identity (REQ-CORE-002, REQ-CORE-009)", () => {
  it("another territory's rep is forbidden; the manager and the admin may open the card", async () => {
    const t = kit(); const { d } = deps();
    const ctx = t.fnCtx(null, { account_id: IDS.miltos });
    (ctx.metadata as any).user = { id: "wuid-center_rep" };
    const center = await defineFunction("visit-card-get", makeImpl(d))(ctx);
    if (errCode(center) !== "forbidden") {
      // the seed may not invite the Center rep as a platform user; then identity itself is refused
      expect(errCode(center)).toBe("forbidden");
    }
    expect(ok(await run(t, d, "eleni", { account_id: IDS.miltos })).account.id).toBe(IDS.miltos);
    expect(ok(await run(t, d, "thanasis", { account_id: IDS.miltos })).account.id).toBe(IDS.miltos);
  });

  it("no platform user -> forbidden; bad or missing account_id -> validation_failed; unknown account -> not_found", async () => {
    const t = kit(); const { d } = deps();
    expect(errCode(await run(t, d, null, { account_id: IDS.miltos }))).toBe("forbidden");
    expect(errCode(await run(t, d, "nikos", {}))).toBe("validation_failed");
    expect(errCode(await run(t, d, "nikos", { account_id: "nope" }))).toBe("validation_failed");
    expect(errCode(await run(t, d, "nikos", { account_id: "00000000-0000-4000-8000-000000000001" }))).toBe("not_found");
  });

  it("a spoofed caller in the body changes nothing", async () => {
    const t = kit(); const { d } = deps();
    const a = ok(await run(t, d, "nikos", { account_id: IDS.miltos, caller: { user_id: IDS.thanasis, role: "admin" } }));
    expect(a.account.id).toBe(IDS.miltos);
  });

  it("the buddy tool path runs the same impl and returns the same card", async () => {
    const t = kit(); const { d } = deps();
    const impl = makeImpl(d);
    const viaTool = ok(await runAsTool("visit-card-get", impl, t.toolCtx("nikos"), { account_id: IDS.miltos }, t.key));
    expect(viaTool).toEqual(ok(await run(t, d, "nikos", { account_id: IDS.miltos })));
    expect(errCode(await runAsTool("visit-card-get", impl, t.toolCtx("nikos", { key: "wrong" }), { account_id: IDS.miltos }, t.key))).toBe("forbidden");
  });
});

describe("visit-card-get helpers", () => {
  it("computeMetrics follows metrics.md (median interval, order_gap, competitor, open_problem, no_visit)", () => {
    const m = computeMetrics({ todayDate: "2026-11-16", confirmedOrderDates: ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"], fallbackFrequency: 14, competitorSignalDates: ["2026-11-10"], openProblemAgesDays: [9], lastVisitDate: "2026-10-01" });
    expect(m.avg_order_interval_days).toBe(7);
    expect(m.days_since_last_order).toBe(25);
    // ratio 25/7 = 3.57 -> min(60, round(40*2.57)=103) = 60; +20 +10 +10 -> 100
    expect(m.risk_score).toBe(100);
    expect(m.risk_reasons).toEqual(["order_gap", "competitor", "open_problem", "no_visit"]);
    const few = computeMetrics({ todayDate: "2026-11-16", confirmedOrderDates: [], fallbackFrequency: 7, competitorSignalDates: [], openProblemAgesDays: [], lastVisitDate: null });
    expect(few).toEqual({ avg_order_interval_days: 7, days_since_last_order: null, risk_score: 0, risk_reasons: [] });
  });

  it("usualItems ranks by repeated quantity, fitSpoken keeps whole sentences within the budget", () => {
    const l = (q: number, id = "p1", name = "Espresso") => ({ product_id: id, name, quantity: q, unit: "kg" });
    const u = usualItems([{ lines: [l(12), l(3, "p2", "Milk")] }, { lines: [l(12), l(4, "p2", "Milk")] }, { lines: [l(12), l(5, "p2", "Milk")] }]);
    expect(u).toEqual([{ product_id: "p1", name: "Espresso", unit: "kg", quantity: 12, repeats: 3 }]);
    expect(fitSpoken(["one two.", "three four five."], 3)).toBe("one two.");
  });

  it("kbFromApi finds the KB by name, asks it, and degrades to [] with a log line", async () => {
    const logs: string[] = []; const seen: string[] = [];
    const api = {
      get: async (p: string) => { seen.push(`GET ${p}`); return [{ id: "kb-1", name: "merc-playbook" }]; },
      post: async (p: string, o?: { body?: unknown }) => { seen.push(`POST ${p} ${JSON.stringify(o?.body)}`); return { version: 1, results: [{ content: "Exactly three arguments." }, { content: "" }] }; },
    };
    const ask = kbFromApi(api, {}, (m) => logs.push(m));
    expect(await ask("merc-playbook", "pitch?")).toEqual(["Exactly three arguments."]);
    expect(await ask("merc-playbook", "again")).toHaveLength(1);
    expect(seen.filter((s) => s.startsWith("GET"))).toHaveLength(1);       // id cached
    expect(seen[1]).toBe('POST /v1/knowledge-bases/kb-1/ask {"question":"pitch?","top_k":4,"source":"api"}');
    expect(await ask("merc-catalog", "x")).toEqual([]);
    expect(logs.join()).toMatch(/merc-catalog not found/);
    expect(await kbFromApi(null, {}, (m) => logs.push(m))("merc-catalog", "x")).toEqual([]);
    expect(logs.join()).toMatch(/no service account/);
    const viaGlobal = kbFromApi({ post: async () => { throw new Error("403"); } }, { globals: { get: () => "kb-9" } }, (m) => logs.push(m));
    expect(await viaGlobal("merc-catalog", "x")).toEqual([]);
    expect(logs.join()).toMatch(/ask failed: 403/);
  });

  it("functions/visit-card-get/handler.gen.js is the current bundle (run `pnpm bundle visit-card-get` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "visit-card-get", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("visit-card-get"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
