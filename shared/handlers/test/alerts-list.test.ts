import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest } from "../../core/src/index";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { handle, impl } from "../src/alerts-list";
import { runAsSystem } from "../../core/src/index";
import { makeImpl as rollup } from "../src/metrics-rollup";
import { makeImpl as engine } from "../src/alerts-engine";

const SEED_NOW = Date.parse("2026-11-16T08:00:00Z");
/** Metrics rollup + alerts engine on the seed at demo day 10:00 Athens. */
async function seededAlerts(t: ReturnType<typeof kit>) {
  ok(await runAsSystem("metrics-rollup", rollup({ now: () => SEED_NOW }), { tables: t.tables, data: {}, orgId: IDS.org }));
  return ok(await runAsSystem("alerts-engine", engine({ now: () => SEED_NOW }), { tables: t.tables, data: {}, orgId: IDS.org }));
}

const LOFOS = "24d14591-c8c2-5885-819a-c5e997f6cad0";

describe("fn:alerts-list", () => {
  it("a rep sees their own open alerts as AlertCards, newest first", async () => {
    const t = kit();
    await seededAlerts(t);
    const r = ok(await handle(t.fnCtx("nikos")));
    const all = await t.db.alert.all({ recipient_id: IDS.nikos, status: "open" });
    expect(r.page).toEqual({ page: 1, limit: 50, total: all.length });
    const lofos = r.items.find((i) => i.type === "going_quiet" && i.account?.id === LOFOS)!;
    expect(lofos).toMatchObject({ severity: "high", status: "open", suggested_action: "Visit or call", account: { name: "Bistro Lofos", account_type: "customer" } });
    expect(r.items.every((i) => i.status === "open")).toBe(true);
  });

  it("REQ-ALR-004: Eleni sees one competition_wave alert in her own list", async () => {
    const t = kit();
    await seededAlerts(t);
    const r = ok(await handle(t.fnCtx("eleni", { scope: "mine" })));
    expect(r.items.filter((i) => i.type === "competition_wave").length).toBe(1);
    expect(r.items.some((i) => i.type === "going_quiet")).toBe(false);
  });

  it("scope team: manager sees her reps' alerts; rep is refused; admin sees the org", async () => {
    const t = kit();
    await seededAlerts(t);
    const team = ok(await handle(t.fnCtx("eleni", { scope: "team", limit: 200 })));
    expect(team.items.some((i) => i.type === "going_quiet" && i.account?.id === LOFOS)).toBe(true);
    expect(errCode(await handle(t.fnCtx("nikos", { scope: "team" })))).toBe("forbidden");
    const admin = ok(await handle(t.fnCtx("thanasis", { scope: "team", limit: 1 })));
    expect(admin.page.total).toBe((await t.db.alert.all({ status: "open" })).length);
    expect(admin.items.length).toBe(1);
  });

  it("status filter and paging (GET params are coerced)", async () => {
    const t = kit();
    await seededAlerts(t);
    const first = (await t.db.alert.findOne({ recipient_id: IDS.nikos }))!;
    await t.db.alert.update(first.id, { status: "dismissed" });
    const d = ok(await handle(t.fnCtx("nikos", { status: "dismissed" })));
    expect(d.items.map((i) => i.alert_id)).toEqual([first.id]);
    const p2 = ok(await handle(t.fnCtx("nikos", { page: "2", limit: "1" })));
    expect(p2.page).toMatchObject({ page: 2, limit: 1 });
    expect(p2.items.length).toBe(1);
  });

  it("identity only from the platform: no user -> forbidden, spoofed caller ignored", async () => {
    const t = kit();
    await seededAlerts(t);
    expect(errCode(await handle(t.fnCtx(null)))).toBe("forbidden");
    const r = ok(await handle(t.fnCtx("dimitra", { caller: { user_id: IDS.nikos } })));
    expect(r.items.some((i) => i.account?.id === LOFOS && i.type === "going_quiet")).toBe(false);
  });

  it("contract: bad enum refused; the buddy tool path gives the same answer", async () => {
    const t = kit();
    await seededAlerts(t);
    expect(validateRequest("alerts-list", { scope: "everyone" }).ok).toBe(false);
    expect(errCode(await handle(t.fnCtx("nikos", { scope: "everyone" })))).toBe("validation_failed");
    expect(ok(await runAsTool("alerts-list", impl, t.toolCtx("nikos"), {}, t.key))).toEqual(ok(await handle(t.fnCtx("nikos"))));
  });

  it("functions/alerts-list/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "alerts-list", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("alerts-list"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
