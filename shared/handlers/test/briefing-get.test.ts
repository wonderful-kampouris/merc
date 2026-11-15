import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateResponse } from "../../core/src/index";
import { unknownNumbers, type ChatModelLike, type ModelFactory } from "../../llm/src/index";
import { handle, impl, makeImpl } from "../src/briefing-get";
import { kit, ok, errCode, IDS, DEMO_DAY, type Kit } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const rowsOf = (t: Kit, table: string) => [...(t.tables.rows.get(table as any)?.values() ?? [])];
const D = { date: DEMO_DAY };


const AT_0800 = Date.parse(`${DEMO_DAY}T06:00:00Z`); // 08:00 Europe/Athens
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
const echoModel = () => fakeModel((input) => ({ script_text: `Καλημέρα Νίκο. ${input.items.map((i: any) => i.display_text).join(". ")}.`, estimated_seconds: 60 }));

describe("fn:briefing-get (REQ-BRF-003)", () => {
  it("generates today's briefing on demand once, then returns the same one; the script is speakable as is", async () => {
    const t = kit();
    const get = makeImpl({ now: () => AT_0800, model: echoModel().factory });
    const h = (await import("../../core/src/index")).defineFunction("briefing-get", get);
    const r = ok(await h(t.fnCtx("nikos")));
    expect(r.date).toBe(DEMO_DAY);
    expect(r.status).toBe("generated");
    expect(r.items[0]).toMatchObject({ position: 1, item_type: "stop", ref_table: "visit" });
    expect(r.items[0]!.display_text).toContain("Café Miltos");
    expect(r.script_text).toContain("Café Miltos");
    expect(unknownNumbers(r.script_text, r.items.map((i) => i.display_text))).toEqual([]);
    expect(validateResponse("briefing-get", r).ok).toBe(true);
    const again = ok(await h(t.fnCtx("nikos")));
    expect(again).toEqual(r);
    expect(rowsOf(t, "briefing")).toHaveLength(1);
  });

  it("regenerate rebuilds in place: same briefing_id, items replaced, still one row", async () => {
    const t = kit();
    const first = ok(await handle(t.fnCtx("nikos", D)));
    const n = rowsOf(t, "briefing_item").length;
    const again = ok(await handle(t.fnCtx("nikos", { ...D, regenerate: "true" })));
    expect(again.briefing_id).toBe(first.briefing_id);
    expect(rowsOf(t, "briefing")).toHaveLength(1);
    expect(rowsOf(t, "briefing_item")).toHaveLength(n);
  });

  it("past dates are never invented (not_found) and cannot be regenerated", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", { date: "2026-01-05" })))).toBe("not_found");
    expect(rowsOf(t, "briefing")).toHaveLength(0);
  });

  it("each caller gets only their own briefing; a spoofed caller in the query is ignored (REQ-CORE-002/009)", async () => {
    const t = kit();
    const nikos = ok(await handle(t.fnCtx("nikos", D)));
    const spoof = ok(await handle(t.fnCtx("dimitra", { ...D, caller: { user_id: IDS.nikos } })));
    expect(spoof.briefing_id).not.toBe(nikos.briefing_id);
    expect(rowsOf(t, "briefing").find((b) => b.id === spoof.briefing_id)!.rep_id).toBe(IDS.dimitra);
    expect(spoof.items.some((i) => i.display_text.includes("Café Miltos"))).toBe(false);
  });

  it("no platform user -> forbidden; bad date -> validation_failed", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx(null, D)))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { date: "16/11/2026" })))).toBe("validation_failed");
  });

  it("the buddy tool path reads the same briefing", async () => {
    const t = kit();
    const viaApp = ok(await handle(t.fnCtx("nikos", D)));
    expect(ok(await runAsTool("briefing-get", impl, t.toolCtx("nikos"), D, t.key))).toEqual(viaApp);
  });

  it("functions/briefing-get/handler.gen.js is the current bundle (run `pnpm bundle briefing-get` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "briefing-get", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("briefing-get"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
