import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsSystem, validateResponse } from "../../core/src/index";
import { validateEvent } from "../../live/src/index";
import { kit, ok, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { makeImpl as rollup } from "../src/metrics-rollup";
import { ALERT_TYPES, handle, makeImpl, previousWorkingDays } from "../src/alerts-engine";

const NOW = Date.parse("2026-11-16T08:00:00Z");
const LOFOS = "24d14591-c8c2-5885-819a-c5e997f6cad0";

async function seededAlerts(t: ReturnType<typeof kit>, push: unknown = null) {
  ok(await runAsSystem("metrics-rollup", rollup({ now: () => NOW }), { tables: t.tables, data: {}, orgId: IDS.org }));
  return ok(await runAsSystem("alerts-engine", makeImpl({ now: () => NOW, push: push as never }), { tables: t.tables, data: {}, orgId: IDS.org }));
}

describe("fn:alerts-engine", () => {
  it("evaluates all 8 seeded rules; Lofos raises going_quiet for its owner", async () => {
    const t = kit();
    const r = await seededAlerts(t);
    expect((r.details as any).rules).toBe(8);
    expect(Object.keys((r.details as any).per_type).sort()).toEqual([...ALERT_TYPES].sort());
    expect((r.details as any).errors).toEqual([]);
    const a = (await t.db.alert.findOne({ dedupe_key: `going_quiet:${LOFOS}:2026-11-04` }))!;
    expect(a).toMatchObject({ alert_type_code: "going_quiet", recipient_id: IDS.nikos, account_id: LOFOS, severity: "high", status: "open" });
    expect(a.message).toBe("Bistro Lofos hasn't ordered in 12 days (usually every 7)");
    expect(validateResponse("alerts-engine", r).ok).toBe(true);
  });

  it("running it twice creates no duplicates", async () => {
    const t = kit();
    const r1 = await seededAlerts(t);
    const n = (await t.db.alert.all()).length;
    expect(r1.created).toBe(n);
    expect(n).toBeGreaterThan(0);
    const r2 = ok(await runAsSystem("alerts-engine", makeImpl({ now: () => NOW }), { tables: t.tables, data: {}, orgId: IDS.org }));
    expect(r2.created).toBe(0);
    expect(r2.processed).toBe(r1.processed);
    expect((await t.db.alert.all()).length).toBe(n);
    const keys = (await t.db.alert.all()).map((a) => a.dedupe_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("REQ-ALR-004: the 3 Aroma signals in the North raise one competition_wave alert for Eleni", async () => {
    const t = kit();
    await seededAlerts(t);
    const waves = await t.db.alert.all({ alert_type_code: "competition_wave" });
    expect(waves.length).toBe(1);
    expect(waves[0]).toMatchObject({ recipient_id: IDS.eleni, territory_id: IDS.north, competitor_id: "94cc0e65-3b44-5d48-b419-32e51aa11446" });
    expect(waves[0]!.message).toBe("3 Aroma Delta signals in North in the last 7 days");
  });

  it("deal, promise and visit rules use the seeded rows", async () => {
    const t = kit();
    await seededAlerts(t);
    const types = (await t.db.alert.all()).map((a) => a.alert_type_code);
    expect(types).toContain("deal_stuck");        // negotiation deal idle since 2026-10-27 (20 days > 14)
    expect(types).toContain("close_date_passed"); // proposal deal expected 2026-11-11
    expect(types).toContain("promise_due");       // Lofos promise due 2026-11-17 (within 1 day)
    const promise = (await t.db.alert.findOne({ alert_type_code: "promise_due" }))!;
    expect(promise).toMatchObject({ task_id: "8573da3a-e392-5b66-948b-44c1fb43852d", recipient_id: IDS.nikos });
  });

  it("manager alerts go to the rep's manager: rep_not_logging and approval_overdue", async () => {
    const t = kit();
    // nikos has planned visits on the last 2 working days and no voice logs
    for (const d of previousWorkingDays("2026-11-16", 2)) await t.db.visit.insert({ account_id: LOFOS, rep_id: IDS.dimitra, origin: "manual", planned_date: d, status: "done" } as never);
    const ap = await t.db.approval.insert({ kind: "discount", requested_by: IDS.dimitra, approver_id: IDS.eleni, mode: "async", status: "pending", due_at: "2026-11-16T07:00:00.000Z" } as never);
    await seededAlerts(t);
    const nl = await t.db.alert.all({ alert_type_code: "rep_not_logging" });
    expect(nl.length).toBeGreaterThan(0);
    expect(nl.every((a) => a.recipient_id === IDS.eleni)).toBe(true);
    expect(nl.some((a) => a.dedupe_key === `rep_not_logging:${IDS.dimitra}:2026-11-13`)).toBe(true);
    const ov = (await t.db.alert.findOne({ dedupe_key: `approval_overdue:${ap.id}` }))!;
    expect(ov.recipient_id).toBe(IDS.eleni);
    // a voice log in the window clears dimitra
    const t2 = kit();
    for (const d of previousWorkingDays("2026-11-16", 2)) await t2.db.visit.insert({ account_id: LOFOS, rep_id: IDS.dimitra, origin: "manual", planned_date: d, status: "done" } as never);
    await t2.db.voice_log.insert({ rep_id: IDS.dimitra, capture_mode: "typed", status: "completed", idempotency_key: "k1", recorded_at: "2026-11-13T10:00:00.000Z" } as never);
    await seededAlerts(t2);
    expect(await t2.db.alert.findOne({ dedupe_key: `rep_not_logging:${IDS.dimitra}:2026-11-13` })).toBeNull();
  });

  it("disabled rules are skipped", async () => {
    const t = kit();
    for (const r of await t.db.alert_rule.all()) await t.db.alert_rule.update(r.id, { enabled: r.alert_type_code === "going_quiet" });
    const r = await seededAlerts(t);
    expect((r.details as any).rules).toBe(1);
    expect((await t.db.alert.all()).every((a) => a.alert_type_code === "going_quiet")).toBe(true);
  });

  it("pushes alert.created to the recipient and their managers' team channels (valid events)", async () => {
    const t = kit();
    const posts: Array<{ path: string; body: any }> = [];
    await seededAlerts(t, { api: { post: async (path: string, o: any) => { posts.push({ path, body: o.body }); return {}; } } });
    const lofos = (await t.db.alert.findOne({ dedupe_key: `going_quiet:${LOFOS}:2026-11-04` }))!;
    const mine = posts.filter((p) => p.body.data.payload.alert.alert_id === lofos.id);
    expect(mine.map((p) => p.body.channel).sort()).toEqual([`rep:${IDS.nikos}`, `team:${IDS.eleni}`]);
    expect(mine.every((p) => p.path === "/v1/function-sockets/messages" && validateEvent(p.body.data).ok)).toBe(true);
    expect(mine[0]!.body.data.payload.alert).toMatchObject({ type: "going_quiet", suggested_action: "Visit or call", account: { id: LOFOS, name: "Bistro Lofos" } });
  });

  it("without a service account the alerts are still written (push is a logged no-op)", async () => {
    const t = kit();
    const r = await seededAlerts(t, null);
    expect(r.created).toBeGreaterThan(0);
    expect((r.details as any).pushes.every((p: any) => p.pushed === false && p.reason === "no_service_account")).toBe(true);
  });

  it("dry_run writes nothing; cron entry runs per org", async () => {
    const t = kit();
    ok(await runAsSystem("metrics-rollup", rollup({ now: () => NOW }), { tables: t.tables, data: {}, orgId: IDS.org }));
    const r = ok(await runAsSystem("alerts-engine", makeImpl({ now: () => NOW }), { tables: t.tables, data: { dry_run: true }, orgId: IDS.org }));
    expect(r.created).toBeGreaterThan(0);
    expect((await t.db.alert.all()).length).toBe(0);
    expect(await handle({ tables: t.tables, data: { dry_run: true }, metadata: {} } as never)).toMatchObject({ orgs: 1, failed: 0 });
    expect((await t.db.alert.all()).length).toBe(0);
  });

  it("functions/alerts-engine/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "alerts-engine", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("alerts-engine"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
