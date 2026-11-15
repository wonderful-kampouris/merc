import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineCron, validateResponse, type FunctionContext } from "../../core/src/index";
import { unknownNumbers, type ChatModelLike, type ModelFactory } from "../../llm/src/index";
import { buildItems, fallbackScript, handle, makeImpl, maxWords, scriptProblems, targetProgress, BRIEFING_MAX_SECONDS, type CronDeps } from "../src/briefing-generate";
import { kit, IDS, DEMO_DAY, type Kit } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const AT_0800 = Date.parse(`${DEMO_DAY}T06:00:00Z`); // 08:00 Europe/Athens (UTC+2), after briefing_time 07:45
const AT_0730 = Date.parse(`${DEMO_DAY}T05:30:00Z`);

/** Fake structured model: `reply(input)` gives the answer (an Error is thrown). Records every call. */
function fakeModel(reply: (input: any, call: number) => unknown) {
  const calls: any[] = [];
  const factory: ModelFactory = (profile) => ({
    withStructuredOutput: () => ({
      invoke: async (messages: any[]) => {
        const input = JSON.parse(messages[1].content);
        calls.push({ profile, input, system: messages[0].content });
        const r = reply(input, calls.length);
        if (r instanceof Error) throw r;
        return r;
      },
    }),
  }) as ChatModelLike;
  return { factory, calls };
}
const echoModel = () => fakeModel((input) => ({ script_text: `Καλημέρα Νίκο. ${input.items.map((i: any) => i.display_text).join(". ")}. Ξεκινάμε με την πρώτη στάση;`, estimated_seconds: 60 }));

const runCron = (t: Kit, deps: CronDeps) => defineCron("briefing-generate", makeImpl(deps))(t.fnCtx(null) as FunctionContext);
const outcomeOf = (r: any) => r.runs[0].outcome;
const rowsOf = (t: Kit, table: string) => [...(t.tables.rows.get(table as any)?.values() ?? [])];
const lofos = (t: Kit) => rowsOf(t, "account").find((a) => a.name === "Bistro Lofos")!;

/** Rows for the item types the seed has no data for (metrics come from fn:metrics-rollup, approvals and candidates from later journeys). */
function addJourneyData(t: Kit) {
  t.tables.load("account_metrics", [{ id: randomUUID(), account_id: lofos(t).id, avg_order_interval_days: 7, last_order_date: "2026-11-04", days_since_last_order: 12, risk_score: 28, risk_reasons: "order_gap", computed_at: `${DEMO_DAY}T03:00:00.000Z` }]);
  t.tables.load("approval", [
    { id: randomUUID(), kind: "discount", requested_by: IDS.nikos, approver_id: IDS.eleni, mode: "async", status: "pending" },
    { id: randomUUID(), kind: "customer_message", requested_by: IDS.nikos, approver_id: IDS.eleni, mode: "live", status: "approved", decided_at: "2026-11-15T15:00:00.000Z" },
  ]);
  t.tables.load("candidate", [{ id: randomUUID(), search_id: randomUUID(), business_name: "Fournos Nea Penteli", external_source: "registry", status: "scored", assigned_rep_id: IDS.nikos }]);
}

describe("fn:briefing-generate (REQ-BRF-001, REQ-BRF-002)", () => {
  it("creates exactly one briefing per active rep per day, pushes briefing.ready, and a second run creates none", async () => {
    const t = kit();
    const pushes: any[] = [];
    const deps: CronDeps = { now: () => AT_0800, model: echoModel().factory, push: async (repId, payload) => { pushes.push({ repId, payload }); return { pushed: true }; } };
    const first = outcomeOf(await runCron(t, deps));
    const reps = rowsOf(t, "app_user").filter((u) => u.role_code === "rep" && u.status === "active");
    expect(first).toMatchObject({ processed: reps.length, created: reps.length });
    expect(validateResponse("briefing-generate", first).ok).toBe(true);
    expect(pushes.map((p) => p.repId).sort()).toEqual(reps.map((r) => r.id).sort());
    expect(pushes[0].payload).toEqual({ briefing_id: expect.any(String), date: DEMO_DAY });

    const second = outcomeOf(await runCron(t, deps));
    expect(second).toMatchObject({ processed: reps.length, created: 0 });
    const briefings = rowsOf(t, "briefing");
    expect(briefings).toHaveLength(reps.length);
    for (const r of reps) expect(briefings.filter((b) => b.rep_id === r.id && b.briefing_date === DEMO_DAY)).toHaveLength(1);
    expect(pushes).toHaveLength(reps.length);
  });

  it("the stored script's numbers are a subset of the items' numbers and it fits 90 s", async () => {
    const t = kit();
    addJourneyData(t);
    await runCron(t, { now: () => AT_0800, model: echoModel().factory });
    for (const b of rowsOf(t, "briefing")) {
      const texts = rowsOf(t, "briefing_item").filter((i) => i.briefing_id === b.id).map((i) => i.display_text);
      expect(unknownNumbers(b.script_text, texts)).toEqual([]);
      expect(scriptProblems(b.script_text, texts, BRIEFING_MAX_SECONDS)).toEqual([]);
    }
  });

  it("does nothing before the org briefing_time (07:45 Athens), and dry_run writes nothing", async () => {
    const t = kit();
    expect(outcomeOf(await runCron(t, { now: () => AT_0730 }))).toMatchObject({ processed: 0, created: 0, details: { skipped: expect.stringContaining("07:45") } });
    const dry = outcomeOf(await defineCron("briefing-generate", makeImpl({ now: () => AT_0800 }))({ ...t.fnCtx(null), data: { dry_run: true } } as FunctionContext));
    expect(dry.created).toBe(0);
    expect(dry.details.reps.every((r: any) => r.status === "would_create")).toBe(true);
    expect(rowsOf(t, "briefing")).toHaveLength(0);
  });

  it("J1: Nikos's briefing has each item type that has data, stops first in route order (REQ-BRF-002)", async () => {
    const t = kit();
    addJourneyData(t);
    const nikos = await t.principal("nikos");
    const items = await buildItems({ db: t.db, org: nikos.org, rep: nikos.user, date: DEMO_DAY, lang: "el" });
    const types = new Set(items.map((i) => i.item_type));
    for (const k of ["stop", "promise_due", "at_risk", "pending_approval", "decision_received", "campaign", "target_progress", "new_prospect"]) expect(types).toContain(k);
    const stops = items.filter((i) => i.item_type === "stop");
    expect(stops).toHaveLength(5);
    expect(stops[0]!.display_text).toContain("Café Miltos");
    expect(stops[0]!.display_text).toContain("grinder");
    expect(items[0]!.item_type).toBe("stop");
    expect(items.map((i) => i.position)).toEqual(items.map((_, i) => i + 1));
    expect(items.find((i) => i.item_type === "promise_due")!.display_text).toContain("Bistro Lofos");
    expect(items.find((i) => i.item_type === "at_risk")!.display_text).toContain("12");
    expect(items.find((i) => i.item_type === "campaign")!.display_text).toContain("Espresso Nuovo");
    // a non-promise task ("Call about delivery") is not a promise item
    expect(items.some((i) => i.display_text.includes("Call about delivery"))).toBe(false);
  });

  it("without the journey rows only the seeded item types appear (no invented at-risk/approvals)", async () => {
    const t = kit();
    const nikos = await t.principal("nikos");
    const types = new Set((await buildItems({ db: t.db, org: nikos.org, rep: nikos.user, date: DEMO_DAY, lang: "en" })).map((i) => i.item_type));
    expect([...types].sort()).toEqual(["campaign", "promise_due", "stop", "target_progress"]);
  });

  it("target progress follows metrics.md (revenue of confirmed lines after discount, visits done) for the user scope", async () => {
    const t = kit();
    const tp = await targetProgress(t.db, IDS.nikos, DEMO_DAY);
    expect(tp.map((x) => x.metric).sort()).toEqual(["revenue", "visits"]);
    const orders = rowsOf(t, "sales_order").filter((o) => o.rep_id === IDS.nikos && o.status === "confirmed" && o.order_date >= "2026-11-01" && o.order_date <= "2026-11-30");
    const ids = new Set(orders.map((o) => o.id));
    const revenue = Math.round(rowsOf(t, "order_line").filter((l) => ids.has(l.order_id)).reduce((s, l) => s + l.quantity * l.unit_price_minor * (1 - (l.discount_pct ?? 0) / 100), 0));
    const visits = rowsOf(t, "visit").filter((v) => v.rep_id === IDS.nikos && v.status === "done" && v.planned_date >= "2026-11-01" && v.planned_date <= "2026-11-30").length;
    const rev = tp.find((x) => x.metric === "revenue")!, vis = tp.find((x) => x.metric === "visits")!;
    expect(rev.actual_value).toBe(revenue);
    expect(rev.pct).toBe(Math.round((1000 * revenue) / 1800000) / 10);
    expect(vis.actual_value).toBe(visits);
    expect(vis.days_left).toBe(14);
  });

  it("an LLM script with an invented number is retried once, then replaced by the deterministic script", async () => {
    const t = kit();
    const bad = fakeModel(() => ({ script_text: "Καλημέρα. Έχεις 99 στάσεις σήμερα.", estimated_seconds: 4 }));
    const out = outcomeOf(await runCron(t, { now: () => AT_0800, model: bad.factory }));
    const nikosRun = out.details.reps.find((r: any) => r.rep_id === IDS.nikos);
    expect(nikosRun).toMatchObject({ status: "created", script: "fallback" });
    expect(nikosRun.script_problems.join(" ")).toContain("99");
    const calls = bad.calls.filter((c) => c.input.rep_name === "Nikos Alexiou");
    expect(calls).toHaveLength(2);
    expect(calls[1].system).toContain("rejected");
    const b = rowsOf(t, "briefing").find((x) => x.rep_id === IDS.nikos)!;
    expect(b.script_text.startsWith("Καλημέρα Nikos.")).toBe(true);
    expect(b.script_text).toContain("Café Miltos");
  });

  it("a model that is down still gives every rep a briefing (fallback), and the deployed entry runs without context.api", async () => {
    const t = kit();
    const down = fakeModel(() => new Error("model unavailable"));
    expect(outcomeOf(await runCron(t, { now: () => AT_0800, model: down.factory })).details.reps.every((r: any) => r.script === "fallback")).toBe(true);
    // handle(): runtime ModelProfiles and context.api are absent in Node -> fallback script, push skipped (no service account)
    const t2 = kit();
    const r: any = await handle(t2.fnCtx(null) as FunctionContext);
    expect(r.failed).toBe(0);
    const o = outcomeOf(r);
    if (o.created > 0) expect(o.details.reps.find((x: any) => x.status === "created").push).toBe("no_service_account");
  });

  it("fallbackScript keeps item order and is trimmed to the word limit", () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ display_text: `Stop ${i + 1}: some shop with a long purpose text here` }));
    const s = fallbackScript("en", "Nikos Alexiou", items);
    expect(s.startsWith("Good morning Nikos. Stop 1:")).toBe(true);
    expect(s.split(/\s+/).length).toBeLessThanOrEqual(maxWords(BRIEFING_MAX_SECONDS));
    expect(fallbackScript("el", "Nikos", [])).toBe("Καλημέρα Nikos. Δεν υπάρχει κάτι προγραμματισμένο για σήμερα.");
  });

  it("functions/briefing-generate/handler.gen.js is the current bundle (run `pnpm bundle briefing-generate` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "briefing-generate", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("briefing-generate"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
    expect(JSON.parse(readFileSync(join(FUNCTIONS, "briefing-generate", "config.json"), "utf8"))).toMatchObject({ kind: "cron", cron_schedules: [{ cron_expression: "*/15 * * * *", enabled: true }] });
  });
});
