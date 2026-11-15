// merc-ops tool glue tests (run: pnpm --dir shared/handlers exec vitest run --root ../../agents/merc-ops).
import { describe, expect, it } from "vitest";
import { kit, IDS } from "../../../shared/handlers/src/_lib/testkit";
import { handle } from "../../../shared/handlers/src/summary-data";
import { FACTS_KEY, factSources, getSummaryData, sendInternalEmail, type OpsCtx } from "../lib/ops";
// @ts-ignore generated bundle has a .d.ts next to it
import { bundleText } from "../scripts/bundle-ops.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEEK = { kind: "weekly", scope_user_id: IDS.eleni, from: "2026-11-09", to: "2026-11-15" };
function ctx(mode: string | null = null) {
  const t = kit();
  const store = new Map<string, unknown>();
  const sent: unknown[] = [];
  const c: OpsCtx = {
    tables: t.tables,
    kv: { get: (k) => { if (!store.has(k)) throw new Error("missing"); return store.get(k); }, set: (k, v) => store.set(k, v) },
    globals: { get: (n) => (n === "MERC_OPS_EMAIL_MODE" ? mode : null) },
    email: { send: (...a: unknown[]) => { sent.push(a); return true; } },
  };
  return { t, c, store, sent };
}

describe("merc-ops tools", () => {
  it("get_summary_data runs the same summary-data impl as the function and keeps the facts in KV", async () => {
    const { t, c, store } = ctx();
    const viaTool = await getSummaryData(c, WEEK);
    const viaFn = await handle(t.fnCtx("eleni", WEEK));
    expect(viaTool).toEqual(viaFn);
    expect((store.get(FACTS_KEY) as unknown[]).length).toBe(1);
  });

  it("send_internal_email refuses before facts, refuses invented numbers, accepts fact numbers", async () => {
    const { c, sent } = ctx("send");
    expect((await sendInternalEmail(c, { to: "eleni@merc-demo.example", subject: "s", body: "b" }) as any).error.code).toBe("invalid_state");
    const out: any = await getSummaryData(c, WEEK);
    const f = out.facts;
    const bad: any = await sendInternalEmail(c, { to: "eleni@merc-demo.example", subject: "Weekly", body: `${f.deals.stuck_count} stuck deals and 987654 EUR won` });
    expect(bad.error.code).toBe("validation_failed");
    expect(bad.error.details.numbers).toContain(987654);
    const good: any = await sendInternalEmail(c, { to: "eleni@merc-demo.example", subject: `Merc weekly summary ${f.from} to ${f.to}`, body: `- Stuck: ${f.deals.stuck_count}\n- Pipeline: ${f.deals.weighted_pipeline}\n- Coming: ${f.deals.coming_count}` });
    expect(good).toMatchObject({ sent: true, mode: "send" });
    expect(sent).toHaveLength(1);
  });

  it("only internal recipients (active managers/admins); default mode only logs", async () => {
    const { c, sent } = ctx(null);
    await getSummaryData(c, WEEK);
    expect((await sendInternalEmail(c, { to: "nikos@merc-demo.example", subject: "x", body: "y" }) as any).error.code).toBe("forbidden");
    expect((await sendInternalEmail(c, { to: "someone@example.com", subject: "x", body: "y" }) as any).error.code).toBe("forbidden");
    expect(await sendInternalEmail(c, { to: "ELENI@merc-demo.example", subject: "Weekly", body: "No numbers here." })).toMatchObject({ sent: false, mode: "log" });
    expect(sent).toHaveLength(0);
  });

  it("fact sources skip ids so uuid digits never whitelist a number", () => {
    expect(factSources({ id: "123", scope_user_id: "fa4c7746-c253-5104-a735-7060bfddb756", n: 5, s: "1500.00 EUR", xs: [{ deal_id: "9" }] })).toEqual(["5", "1500.00 EUR"]);
  });

  it("lib/ops.gen.js is the current bundle", async () => {
    expect(readFileSync(join(__dirname, "../lib/ops.gen.js"), "utf8") === (await bundleText())).toBe(true);
  });
});
