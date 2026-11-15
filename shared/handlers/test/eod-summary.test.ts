import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineFunction, runAsTool, validateResponse } from "../../core/src/index";
import { unknownNumbers, type ChatModelLike, type ModelFactory } from "../../llm/src/index";
import { handle, impl, makeImpl, EOD_MAX_SECONDS } from "../src/eod-summary";
import { maxWords, wordCount } from "../src/briefing-generate";
import { kit, ok, errCode, IDS, DEMO_DAY, type Kit } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const D = { date: DEMO_DAY };
const rowsOf = (t: Kit, table: string) => [...(t.tables.rows.get(table as any)?.values() ?? [])];

/** Nikos's J1 day: Miltos and Avra visited, Avra became a customer, one follow-up email sent. */
async function j1Day(t: Kit) {
  const today = rowsOf(t, "visit").filter((v) => v.rep_id === IDS.nikos && v.planned_date === DEMO_DAY);
  for (const pos of [1, 2]) await t.db.visit.update(today.find((v) => v.route_position === pos)!.id, { status: "done", completed_at: `${DEMO_DAY}T0${7 + pos}:30:00.000Z` });
  const avra = rowsOf(t, "account").find((a) => a.name === "Café Avra")!;
  await t.db.account.update(avra.id, { account_type: "customer", customer_since: DEMO_DAY });
  t.tables.load("approval", [{ id: randomUUID(), kind: "customer_message", requested_by: IDS.nikos, approver_id: IDS.nikos, mode: "live", status: "sent", decided_at: `${DEMO_DAY}T09:00:00.000Z` }]);
}


/** Fake structured model (same as in briefing-generate.test.ts). */
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


describe("fn:eod-summary (REQ-BUD-010)", () => {
  it("J1 wrap-up: counts what got done, lists what is open, says where tomorrow starts, within 45 s", async () => {
    const t = kit();
    await j1Day(t);
    const r = ok(await handle(t.fnCtx("nikos", D)));
    expect(validateResponse("eod-summary", r).ok).toBe(true);
    expect(r).toMatchObject({ date: DEMO_DAY, visits_done: 2, offers_sent: 1, new_customers: 1 });
    expect(r.pending).toEqual(expect.arrayContaining([expect.stringContaining("Bistro Lofos"), expect.stringContaining("Call about delivery")]));
    expect(r.pending.some((p) => p.includes("Café Miltos"))).toBe(false);
    expect(r.tomorrow_start_with).toContain("Artos Chalandriou");
    expect(r.target_progress.map((x) => x.metric).sort()).toEqual(["revenue", "visits"]);
    expect(wordCount(r.spoken_summary)).toBeLessThanOrEqual(maxWords(EOD_MAX_SECONDS));
    expect(r.spoken_summary).toContain("2");
  });

  it("an LLM summary is used when its numbers come from the facts; an invented number falls back after one retry", async () => {
    const t = kit();
    await j1Day(t);
    const good = fakeModel((input) => ({ spoken_summary: `Μπράβο! ${input.facts[0].value} επισκέψεις σήμερα.`, learned: null }));
    const g = ok(await defineFunction("eod-summary", makeImpl({ model: good.factory }))(t.fnCtx("nikos", D)));
    expect(g.spoken_summary).toBe("Μπράβο! 2 επισκέψεις σήμερα.");
    expect(good.calls[0].input.language).toBe("el");
    const bad = fakeModel(() => ({ spoken_summary: "Έκανες 7 επισκέψεις.", learned: "Πούλησες 40 κιλά." }));
    const b = ok(await defineFunction("eod-summary", makeImpl({ model: bad.factory }))(t.fnCtx("nikos", D)));
    expect(bad.calls).toHaveLength(2);
    expect(b.learned).toBeNull();
    const facts = [String(b.visits_done), String(b.offers_sent), String(b.new_customers), ...b.pending, b.tomorrow_start_with ?? ""];
    expect(unknownNumbers(b.spoken_summary, [...facts, ...good.calls[0].input.facts.map((f: any) => f.value)])).toEqual([]);
  });

  it("scope: each rep only sees their own day; a spoofed caller is ignored; no user -> forbidden", async () => {
    const t = kit();
    await j1Day(t);
    const d = ok(await handle(t.fnCtx("dimitra", { ...D, caller: { user_id: IDS.nikos } })));
    expect(d.visits_done).toBe(0);
    expect(d.pending.some((p) => p.includes("Bistro Lofos"))).toBe(false);
    expect(errCode(await handle(t.fnCtx(null, D)))).toBe("forbidden");
  });

  it("the buddy tool path gives the same summary", async () => {
    const t = kit();
    await j1Day(t);
    expect(ok(await runAsTool("eod-summary", impl, t.toolCtx("nikos"), D, t.key))).toEqual(ok(await handle(t.fnCtx("nikos", D))));
  });

  it("functions/eod-summary/handler.gen.js is the current bundle (run `pnpm bundle eod-summary` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "eod-summary", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("eod-summary"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
