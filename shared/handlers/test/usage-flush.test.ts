import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, makeImpl } from "../src/usage-flush";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const audits = (t: ReturnType<typeof kit>) => t.db.audit_event.all();
import { localDate, runAsSystem } from "../../core/src/index";

const NOW = Date.now();
const DAY = localDate("Europe/Athens", NOW - 3_600_000);

describe("fn:usage-flush (REQ-SET-005)", () => {
  it("recounts usage per user per local day and is idempotent", async () => {
    const t = kit();
    const at = new Date(NOW - 3_600_000).toISOString();
    await t.db.voice_log.insert({ rep_id: IDS.nikos, idempotency_key: "u1", capture_mode: "live_buddy", status: "completed", transcript: Array(280).fill("word").join(" "), recorded_at: at } as any);
    await t.db.voice_log.insert({ rep_id: IDS.nikos, idempotency_key: "u2", capture_mode: "typed", status: "completed", transcript: "typed", recorded_at: at } as any);
    await t.db.prospect_search.insert({ requested_by: IDS.nikos, origin: "manual", status: "done", area_text: "Chalandri" } as any);
    const impl = makeImpl(() => NOW);
    const run = () => runAsSystem("usage-flush", impl, { tables: t.tables, data: {}, orgId: IDS.org });
    const r1: any = ok(await run());
    expect(validateResponse("usage-flush", r1).ok).toBe(true);
    expect(r1.created).toBeGreaterThanOrEqual(1);
    const rows = await t.db.usage_event.all({ user_id: IDS.nikos, day: DAY });
    expect(rows.find((r) => r.kind === "voice_minutes")!.quantity).toBe(2);
    expect((await t.db.usage_event.all({ user_id: IDS.nikos, kind: "research_runs" })).reduce((n, r) => n + r.quantity, 0)).toBe(1);
    const r2: any = ok(await run());
    expect(r2.created).toBe(0);
    expect(r2.details.updated).toBe(0);
    expect((await t.db.usage_event.all({ user_id: IDS.nikos, day: DAY })).length).toBe(rows.length);
  });
  it("dry_run writes nothing; the cron entry runs once per org", async () => {
    const t = kit();
    await t.db.prospect_search.insert({ requested_by: IDS.nikos, origin: "manual", status: "done", area_text: "x" } as any);
    const r: any = ok(await runAsSystem("usage-flush", makeImpl(), { tables: t.tables, data: { dry_run: true }, orgId: IDS.org }));
    expect(r.details.dry_run).toBe(true);
    expect(await t.db.usage_event.count()).toBe(0);
    const cron: any = await handle({ tables: t.tables, data: { dry_run: true } } as any);
    expect(cron.orgs).toBe(1);
    expect(cron.failed).toBe(0);
    expect(validateRequest("usage-flush", { dry_run: true }).ok).toBe(true);
    void runAsTool; void audits; void errCode;
  });

  it("functions/usage-flush/handler.gen.js is the current bundle (run `pnpm bundle usage-flush` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "usage-flush", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("usage-flush"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
