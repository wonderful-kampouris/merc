import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsTool, runAsSystem, validateRequest, type Impl } from "../../core/src/index";
import { validateSchema, llmContract, defSchemas, extractNumbers } from "../../llm/src/index";
import {
  chooseHints, checkBriefResponse, checkOutput, makeImpl, productsMentioned, shortName, MAX_BULLETS, MAX_BULLET_WORDS, MAX_SCRIPT_WORDS,
  type BriefDeps, type BulletsInput, type BulletsOutput, type HintInput,
} from "../src/visit-brief-get";
import { kit, ok, errCode, IDS, DEMO_DAY } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const P = {
  nuovo: "b28bc378-ec47-55d6-a414-b09ac0dacc3d", frappe: "49df0bbb-3efc-5c7f-98e6-5e8e241addba", hotChoc: "f95e0b6b-9dc7-58e5-8ca3-c1e4ba509909",
  plantMilk: "41aad187-06aa-591a-9638-3a8396116985", vanilla: "fb2b8f20-27e3-57ac-89c9-01284cf6298d", decaf: "e309442c-0c3b-5cef-9395-98919bae50b8",
  classico: "120d56dc-215d-557d-bbab-43d87e1047c4",
};
const G = { nuovoPush: "f4769c9a-edad-5ad8-8a96-342d5679c928", frappeAvoid: "c248ff6b-b8e3-5313-8d96-23077adef376" };
const VISIT = { miltos: "dd6c531d-1412-5df9-8f6e-5df01556c7a8", elena: "bf5b3edc-2bff-5947-818a-408a1121f19b", avra: "94cc38be-45f7-5185-938c-b7c4871a2101" };
const CAFE = "5a1d91e1-bd02-5226-ba0c-74b19254ab62";
const KOLONAKI = "4cfe45a4-9761-5595-adb2-c1af5a6f2329"; // Center territory
const NOW = Date.parse(`${DEMO_DAY}T06:00:00Z`);       // 08:00 Athens, before the 10:45 Miltos visit

type Llm = (input: BulletsInput) => BulletsOutput | Error;
function deps(llm?: Llm) {
  const calls = { llm: [] as BulletsInput[], kb: [] as string[], logs: [] as string[] };
  const d: BriefDeps = {
    bullets: async (input) => {
      calls.llm.push(input);
      if (!llm) return { ok: false, error: { code: "upstream_failed", message: "no model in tests" } as any, attempts: 1, profile: "p", logs: [] };
      const v = llm(input);
      if (v instanceof Error) throw v;
      return { ok: true, value: v, attempts: 1, profile: "p", logs: [] };
    },
    kb: async (q) => { calls.kb.push(q); return ["Quality over volume: we protect the premium position of our espresso."]; },
    now: () => NOW,
    log: (m) => calls.logs.push(m),
  };
  return { d, calls };
}
const run = (t: ReturnType<typeof kit>, d: BriefDeps, who: "nikos" | "eleni" | "dimitra" | "thanasis" | null, body: unknown) =>
  defineFunction("visit-brief-get", makeImpl(d) as Impl<"visit-brief-get">, { checkResponse: false })(t.fnCtx(who, body));

/** Every number in bullets + script is in a fact value or the push/avoid rows (Rule A). */
function ungrounded(r: any, input: BulletsInput | null, extra: string[] = []) {
  const src = [...(input?.facts.map((f) => f.value) ?? []), r.push?.name, r.push?.reason, r.avoid?.name, r.avoid?.reason, r.visit.account.name, ...extra].filter(Boolean).join(" \n ");
  const allowed = extractNumbers(src);
  return [...r.bullets.map((b: any) => b.text), r.spoken_script].flatMap((s: string) => extractNumbers(s).filter((n) => !allowed.some((a) => Math.abs(a - n) < 1e-6)));
}

const goodLlm: Llm = (i) => ({
  bullets: [
    { text: "Grinder noise is still open; promise a technician date first.", fact_labels: ["open_problem_1"] },
    { text: `They usually take ${i.facts.find((f) => f.label === "usual_order_1")!.value.split(" ").slice(0, 2).join(" ")} Espresso Classico.`, fact_labels: ["usual_order_1"] },
    { text: `Push ${shortName(i.push.name)}: forgiving on a worn grinder.`, fact_labels: [] },
    { text: `Avoid ${shortName(i.avoid.name)}: off-brand for a specialty café.`, fact_labels: [] },
    { text: "Talk to Miltos directly, keep it short.", fact_labels: ["decision_maker"] },
  ],
  spoken_script: `Café Miltos at ${i.facts.find((f) => f.label === "planned_start")!.value}. Fix the grinder first, then offer ${shortName(i.push.name)}; skip ${shortName(i.avoid.name)}.`,
});

// ---------------------------------------------------------------------------------------------- chooseHints (metrics.md)
describe("chooseHints = metrics.md#visit-brief-hints (REQ-MTG-003)", () => {
  const g = (id: string, product_id: string, stance: "push" | "avoid", priority: number, over: Partial<HintInput["guidance"][number]> = {}) =>
    ({ id, product_id, category_id: CAFE, stance, reason: `${id} reason`, priority, valid_from: null, valid_to: null, active: true, ...over });
  const base = (over: Partial<HintInput> = {}): HintInput => ({
    today: "2026-11-16", category_id: CAFE,
    guidance: [g("g1", "a", "push", 30), g("g2", "b", "push", 40), g("g3", "x", "avoid", 10), g("g4", "y", "avoid", 20)],
    products: new Map([["a", { name: "Alpha" }], ["b", { name: "Beta" }], ["c", { name: "Gamma" }], ["x", { name: "Xeno" }], ["y", { name: "Ypsilon" }]]),
    campaignProducts: new Map(), problemProducts: new Set(), feedbackSkip: new Set(), recentlyOrdered: new Set(), ...over,
  });

  it("highest priority wins without boosts; avoid = highest priority avoid", () => {
    const h = chooseHints(base());
    expect(h.push?.product_id).toBe("b");
    expect(h.avoid?.product_id).toBe("y");
  });
  it("campaign boost +50 beats a higher base priority and is named in the reason", () => {
    const h = chooseHints(base({ campaignProducts: new Map([["a", "Alpha week"]]) }));
    expect(h.push).toMatchObject({ product_id: "a", score: 80 });
    expect(h.push!.reason).toMatch(/campaign: Alpha week/);
  });
  it("open-problem pairing +25", () => {
    expect(chooseHints(base({ problemProducts: new Set(["a"]) })).push).toMatchObject({ product_id: "a", score: 55 });
  });
  it("category match: other categories are not candidates; null category applies to all", () => {
    const h = chooseHints(base({ guidance: [g("g1", "a", "push", 30, { category_id: "bakery" }), g("g2", "c", "push", 5, { category_id: null })] }));
    expect(h.push?.product_id).toBe("c");
  });
  it("validity window, inactive rows and inactive products are skipped", () => {
    const h = chooseHints(base({
      guidance: [g("g1", "a", "push", 90, { valid_from: "2026-11-17" }), g("g2", "b", "push", 80, { valid_to: "2026-11-15" }), g("g5", "c", "push", 70, { active: false }), g("g6", "zz", "push", 60), g("g7", "x", "push", 1)],
    }));
    expect(h.push?.product_id).toBe("x");
  });
  it("30-day brief_not_useful feedback skips the push product (REQ-MTG-008)", () => {
    const h = chooseHints(base({ feedbackSkip: new Set(["b"]) }));
    expect(h.push?.product_id).toBe("a");
    expect(h.skipped).toContainEqual({ product_id: "b", why: "feedback" });
  });
  it("a product ordered in the last 30 days is skipped", () => {
    const h = chooseHints(base({ recentlyOrdered: new Set(["b"]) }));
    expect(h.push?.product_id).toBe("a");
    expect(h.skipped).toContainEqual({ product_id: "b", why: "recent_order" });
  });
  it("avoid wins: a product with both stances is avoided, never pushed", () => {
    const h = chooseHints(base({ guidance: [g("g1", "a", "push", 30), g("g2", "b", "push", 40), g("g3", "b", "avoid", 1)] }));
    expect(h.push?.product_id).toBe("a");
    expect(h.avoid?.product_id).toBe("b");
  });
  it("ties break on product name; no candidate -> null (never invented)", () => {
    expect(chooseHints(base({ guidance: [g("g1", "b", "push", 10), g("g2", "a", "push", 10)] })).push?.product_id).toBe("a");
    const none = chooseHints(base({ guidance: [] }));
    expect(none.push).toBeNull();
    expect(none.avoid).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------- the handler on the seed
describe("fn:visit-brief-get on the seed (REQ-MTG-002/003)", () => {
  it("Miltos (code wording): grinder, 12 kg, push Espresso Nuovo, avoid Frappé Instant, <= 6 bullets, all numbers grounded", async () => {
    const t = kit(); const { d, calls } = deps();
    const r = ok(await run(t, d, "nikos", { visit_id: VISIT.miltos }));
    expect(checkBriefResponse(r).ok).toBe(true);
    expect(r.push).toMatchObject({ product_id: P.nuovo, name: "Espresso Nuovo Blend 1kg" });
    expect(r.push.reason).toMatch(/campaign: Espresso Nuovo to cafés/);
    expect(r.avoid).toMatchObject({ product_id: P.frappe, name: "Frappé Instant 1kg" });
    expect(r.bullets.length).toBeLessThanOrEqual(MAX_BULLETS);
    const text = r.bullets.map((b) => b.text).join("\n");
    expect(text).toMatch(/grinder/i);
    expect(text).toMatch(/12 kg/);
    expect(text).toMatch(/Espresso Nuovo/);
    expect(text).toMatch(/Frappé Instant/);
    for (const b of r.bullets) expect(b.text.split(/\s+/).length).toBeLessThanOrEqual(MAX_BULLET_WORDS + 1);
    expect(r.spoken_script.split(/\s+/).length).toBeLessThanOrEqual(MAX_SCRIPT_WORDS);
    expect(ungrounded(r, calls.llm[0] ?? null)).toEqual([]);
    expect(r.status).toBe("generated");
    expect(r.visit).toMatchObject({ visit_id: VISIT.miltos, planned_date: DEMO_DAY });
    // the LLM input validates against contracts/llm/visit_brief_bullets.json
    expect(calls.llm).toHaveLength(1);
    expect(validateSchema(llmContract("visit_brief_bullets").input, calls.llm[0], defSchemas)).toEqual([]);
    expect(calls.kb[0]).toMatch(/Espresso Nuovo/);
    // stored in tbl:visit_brief
    const row = await t.db.visit_brief.findOne({ visit_id: VISIT.miltos });
    expect(row).toMatchObject({ push_product_id: P.nuovo, push_guidance_id: G.nuovoPush, avoid_product_id: P.frappe, avoid_guidance_id: G.frappeAvoid, rep_id: IDS.nikos, status: "generated" });
    expect(row!.bullets_text.split("\n")).toEqual(r.bullets.map((b) => b.text));
  });

  it("Miltos with a grounded LLM: its wording is used, numbers grounded, refs point to rows", async () => {
    const t = kit(); const { d, calls } = deps(goodLlm);
    const r = ok(await run(t, d, "nikos", { visit_id: VISIT.miltos }));
    expect(r.bullets.map((b) => b.text)).toContain("They usually take 12 kg Espresso Classico.");
    expect(r.bullets.find((b) => /Espresso Nuovo/.test(b.text))).toMatchObject({ ref_table: "product_guidance", ref_id: G.nuovoPush });
    expect(r.spoken_script).toMatch(/^Café Miltos at \d\d:\d\d\./);
    expect(ungrounded(r, calls.llm[0]!)).toEqual([]);
    expect(calls.logs.filter((l) => /dropped|rejected|names product/.test(l))).toEqual([]);
  });

  it("an LLM output naming another product is rejected (code wording, same push/avoid)", async () => {
    const t = kit(); const { d, calls } = deps((i) => ({ ...goodLlm(i), bullets: [...goodLlm(i).bullets.slice(0, 4), { text: "Also offer Hot Chocolate for winter.", fact_labels: [] }] }));
    const r = ok(await run(t, d, "nikos", { visit_id: VISIT.miltos }));
    expect(r.push.product_id).toBe(P.nuovo);
    expect(r.bullets.map((b) => b.text).join(" ")).not.toMatch(/Hot Chocolate/);
    expect(r.spoken_script).not.toMatch(/Hot Chocolate/);
    expect(calls.logs.some((l) => /other than push\/avoid: Hot Chocolate/.test(l))).toBe(true);
  });

  it("a bullet with an ungrounded number is dropped; an ungrounded script falls back to code", async () => {
    const t = kit(); const { d, calls } = deps((i) => ({ bullets: [...goodLlm(i).bullets.slice(0, 2), { text: "Offer 20% off on Espresso Nuovo Blend.", fact_labels: [] }, ...goodLlm(i).bullets.slice(2)], spoken_script: "Give them 15 free bags." }));
    const r = ok(await run(t, d, "nikos", { visit_id: VISIT.miltos }));
    expect(r.bullets.map((b) => b.text).join(" ")).not.toMatch(/20%/);
    expect(r.spoken_script).not.toMatch(/15/);
    expect(ungrounded(r, calls.llm[0]!)).toEqual([]);
    expect(calls.logs.some((l) => /ungrounded number 20/.test(l))).toBe(true);
  });

  it("an LLM error or a throw still answers with the code wording", async () => {
    const t = kit(); const { d } = deps(() => new Error("boom"));
    const r = ok(await run(t, d, "nikos", { visit_id: VISIT.miltos }));
    expect(r.push.product_id).toBe(P.nuovo);
  });

  it("deactivating Nuovo's guidance row pushes Hot Chocolate (plant milk and syrup ordered in the last 30 days)", async () => {
    const t = kit(); const { d } = deps();
    await t.db.product_guidance.update(G.nuovoPush, { active: false } as any);
    const r = ok(await run(t, d, "nikos", { visit_id: VISIT.miltos }));
    expect(r.push.product_id).toBe(P.hotChoc);
    expect(r.avoid.product_id).toBe(P.frappe);
  });

  it("'Brief did not help' on Nuovo -> the next brief pushes Hot Chocolate (REQ-MTG-008); feedback older than 30 days does not", async () => {
    const t = kit(); const { d } = deps();
    const first = ok(await run(t, d, "nikos", { visit_id: VISIT.miltos }));
    const fb = await t.db.rep_feedback.insert({ rep_id: IDS.nikos, account_id: IDS.miltos, kind: "brief_not_useful", visit_brief_id: first.visit_brief_id, product_id: P.nuovo, exported_to_evals: false } as any);
    (t.tables.rows.get("rep_feedback")!.get(fb.id)!).created_at = NOW - 2 * 86_400_000;
    const again = ok(await run(t, d, "nikos", { visit_id: VISIT.miltos, regenerate: true }));
    expect(again.push.product_id).toBe(P.hotChoc);
    expect(again.visit_brief_id).toBe(first.visit_brief_id);
    (t.tables.rows.get("rep_feedback")!.get(fb.id)!).created_at = NOW - 31 * 86_400_000;
    expect(ok(await run(t, d, "nikos", { visit_id: VISIT.miltos, regenerate: true })).push.product_id).toBe(P.nuovo);
  });

  it("returns the stored brief unless regenerate", async () => {
    const t = kit(); const { d, calls } = deps(goodLlm);
    const a = ok(await run(t, d, "nikos", { visit_id: VISIT.miltos }));
    const b = ok(await run(t, d, "nikos", { visit_id: VISIT.miltos }));
    expect(calls.llm).toHaveLength(1);
    expect(b.visit_brief_id).toBe(a.visit_brief_id);
    expect(b.bullets.map((x) => x.text)).toEqual(a.bullets.map((x) => x.text));
    expect(b.push).toEqual(a.push);
    expect(b.spoken_script).toBe(a.spoken_script);
    expect(checkBriefResponse(b).ok).toBe(true);
    ok(await run(t, d, "nikos", { visit_id: VISIT.miltos, regenerate: true }));
    expect(calls.llm).toHaveLength(2);
    expect(await t.db.visit_brief.count({ visit_id: VISIT.miltos })).toBe(1);
  });

  it("account_id -> the rep's next planned visit there today; exactly one of visit_id/account_id", async () => {
    const t = kit(); const { d } = deps();
    expect(ok(await run(t, d, "nikos", { account_id: IDS.miltos })).visit.visit_id).toBe(VISIT.miltos);
    expect(errCode(await run(t, d, "nikos", {}))).toBe("validation_failed");
    expect(errCode(await run(t, d, "nikos", { account_id: IDS.miltos, visit_id: VISIT.miltos }))).toBe("validation_failed");
    expect(errCode(await run(t, d, "eleni", { account_id: IDS.miltos }))).toBe("not_found"); // Eleni has no visit there today
  });

  it("Mini Market Elena (no push guidance): push omitted, out-of-stock Decaf avoided, response otherwise valid", async () => {
    const t = kit(); const { d, calls } = deps(goodLlm);
    const r = ok(await run(t, d, "nikos", { visit_id: VISIT.elena })) as any;
    expect(r.push).toBeUndefined();
    expect(r.avoid).toMatchObject({ product_id: P.decaf });
    expect(r.avoid.reason).toMatch(/Out of stock/);
    expect(calls.llm).toHaveLength(0);                       // no push to word: code wording only
    expect(checkBriefResponse(r).ok).toBe(true);
    expect(r.bullets.some((b: any) => /Espresso Decaf: Out of stock/.test(b.text))).toBe(true);
  });

  it("scope: another territory's account is forbidden (REQ-CORE-009); no user is forbidden", async () => {
    const t = kit(); const { d } = deps();
    expect(errCode(await run(t, d, "nikos", { account_id: KOLONAKI }))).toBe("forbidden");
    expect(errCode(await run(t, d, null, { visit_id: VISIT.miltos }))).toBe("forbidden");
  });

  it("ignores a spoofed caller in the body", async () => {
    const t = kit(); const { d } = deps();
    const r = ok(await run(t, d, "nikos", { visit_id: VISIT.miltos, caller: { user_id: IDS.thanasis, role: "admin" } }));
    expect((await t.db.visit_brief.get(r.visit_brief_id))!.rep_id).toBe(IDS.nikos);
  });

  it("the buddy tool path and a system caller give the same push/avoid", async () => {
    const t = kit(); const { d } = deps();
    const viaFn = ok(await run(t, d, "nikos", { visit_id: VISIT.miltos }));
    const viaTool = ok(await runAsTool("visit-brief-get", makeImpl(d) as Impl<"visit-brief-get">, t.toolCtx("nikos"), { visit_id: VISIT.miltos, regenerate: true }, t.key, { checkResponse: false }));
    expect(viaTool).toEqual(viaFn);
    const t2 = kit();
    const sys = ok(await runAsSystem("visit-brief-get", makeImpl(deps().d), { tables: t2.tables, data: { visit_id: VISIT.miltos }, orgId: IDS.org, checkResponse: false }));
    expect(sys.push.product_id).toBe(P.nuovo);
    expect((await t2.db.visit_brief.get(sys.visit_brief_id))!.rep_id).toBe(IDS.nikos);
  });

  it("Café Avra (prospect, same category): Nuovo push, Frappé avoid", async () => {
    const t = kit(); const { d } = deps();
    const r = ok(await run(t, d, "nikos", { visit_id: VISIT.avra }));
    expect([r.push.product_id, r.avoid.product_id]).toEqual([P.nuovo, P.frappe]);
  });
});

// ---------------------------------------------------------------------------------------------- contract + output checks
describe("contract and output checks", () => {
  it("requests validate against spec/contracts/functions/visit-brief-get.json (GET coercion)", () => {
    expect(validateRequest("visit-brief-get", { visit_id: VISIT.miltos, regenerate: "true" }, { coerce: true }).ok).toBe(true);
    expect(validateRequest("visit-brief-get", { visit_id: "not-a-uuid" }, { coerce: true }).ok).toBe(false);
    expect(validateRequest("visit-brief-get", { extra: 1 }, { coerce: true }).ok).toBe(false);
  });
  it("checkBriefResponse tolerates only a missing push/avoid", () => {
    const base = { visit_brief_id: VISIT.miltos, visit: { visit_id: VISIT.miltos, account: { id: IDS.miltos, name: "x", account_type: "customer" }, planned_date: DEMO_DAY, status: "planned" }, bullets: [], spoken_script: "", status: "generated" };
    expect(checkBriefResponse(base).ok).toBe(true);
    expect(checkBriefResponse({ ...base, status: "nope" }).ok).toBe(false);
    expect(checkBriefResponse({ ...base, push: { product_id: "x" } }).ok).toBe(false);
  });
  it("product mentions match short names case- and accent-insensitively", () => {
    const products = [{ id: "n", name: "Espresso Nuovo Blend 1kg" }, { id: "f", name: "Frappé Instant 1kg" }, { id: "c", name: "Paper Cups 12oz x1000" }];
    expect([...productsMentioned("avoid frappe instant, push ESPRESSO NUOVO", products)].sort()).toEqual(["f", "n"]);
    expect([...productsMentioned("paper cups are fine", products)]).toEqual(["c"]);
  });
  it("checkOutput: products already in the facts may be named (usual order), others reject", () => {
    const facts = [{ label: "usual_order_1", value: "12 kg Espresso Classico 1kg", ref_table: "product", ref_id: P.classico }];
    const products = [{ id: P.classico, name: "Espresso Classico 1kg" }, { id: P.nuovo, name: "Espresso Nuovo Blend 1kg" }, { id: P.frappe, name: "Frappé Instant 1kg" }, { id: P.hotChoc, name: "Hot Chocolate 1kg" }];
    const push = { product_id: P.nuovo, name: "Espresso Nuovo Blend 1kg", reason: "r", guidance_id: "g1", score: 1 };
    const avoid = { product_id: P.frappe, name: "Frappé Instant 1kg", reason: "r", guidance_id: "g2", score: 1 };
    const out = (extra: string) => ({ bullets: [{ text: "Usually 12 kg Espresso Classico.", fact_labels: ["usual_order_1"] }, { text: "Push Espresso Nuovo.", fact_labels: [] }, { text: "Avoid Frappé Instant.", fact_labels: [] }, ...(extra ? [{ text: extra, fact_labels: [] }] : [])], spoken_script: "Short." });
    const okc = checkOutput(out(""), { facts, push, avoid, products, sources: [] });
    expect(okc.bullets).toHaveLength(3);
    expect(okc.bullets![0]).toMatchObject({ ref_table: "product", ref_id: P.classico });
    expect(checkOutput(out("Try Hot Chocolate."), { facts, push, avoid, products, sources: [] }).bullets).toBeNull();
    const long = checkOutput(out("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen words"), { facts, push, avoid, products, sources: [] });
    expect(long.bullets).toHaveLength(3);
  });

  it("functions/visit-brief-get/handler.gen.js is the current bundle (run `pnpm bundle visit-brief-get` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "visit-brief-get", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("visit-brief-get"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
