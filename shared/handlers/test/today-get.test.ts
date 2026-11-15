import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateResponse } from "../../core/src/index";
import { handle, impl } from "../src/today-get";
import { handle as briefingGet } from "../src/briefing-get";
import { kit, ok, errCode, IDS, DEMO_DAY } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const D = { date: DEMO_DAY };

describe("fn:today-get (REQ-BRF-004 server side)", () => {
  it("lists the caller's stops in route order with their reason, and the briefing id once it exists", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("nikos", D)));
    expect(validateResponse("today-get", r).ok).toBe(true);
    expect(r.date).toBe(DEMO_DAY);
    expect(r.visits.map((v) => v.account.name)).toEqual(["Café Miltos", "Café Avra", "Bistro Lofos", "Mini Market Elena", "Fournos Gonia"]);
    expect(r.visits.map((v) => v.route_position)).toEqual([1, 2, 3, 4, 5]);
    expect(r.visits[0]).toMatchObject({ status: "planned", planned_date: DEMO_DAY, purpose: expect.stringContaining("grinder"), reason: expect.stringContaining("grinder") });
    expect(r.visits[1]!.account.account_type).toBe("prospect");
    expect(r.briefing_id).toBeNull();
    expect(r.pending_recordings_hint).toBe(0);
    const b = ok(await briefingGet(t.fnCtx("nikos", D)));
    expect(ok(await handle(t.fnCtx("nikos", D))).briefing_id).toBe(b.briefing_id);
  });

  it("counts the caller's voice logs still in flight", async () => {
    const t = kit();
    const vl = (rep: string, status: string) => ({ id: randomUUID(), rep_id: rep, capture_mode: "offline_recording", status, idempotency_key: randomUUID(), recorded_at: `${DEMO_DAY}T08:00:00.000Z` });
    t.tables.load("voice_log", [vl(IDS.nikos, "processing"), vl(IDS.nikos, "completed"), vl(IDS.dimitra, "processing")]);
    expect(ok(await handle(t.fnCtx("nikos", D))).pending_recordings_hint).toBe(1);
  });

  it("another rep never sees Nikos's stops; a spoofed caller is ignored", async () => {
    const t = kit();
    const nikos = ok(await handle(t.fnCtx("nikos", D))).visits.map((v) => v.visit_id);
    const dimitra = ok(await handle(t.fnCtx("dimitra", { ...D, caller: { user_id: IDS.nikos } }))).visits.map((v) => v.visit_id);
    expect(dimitra.filter((id) => nikos.includes(id))).toEqual([]);
  });

  it("no platform user -> forbidden; tool path gives the same answer", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx(null, D)))).toBe("forbidden");
    expect(ok(await runAsTool("today-get", impl, t.toolCtx("nikos"), D, t.key))).toEqual(ok(await handle(t.fnCtx("nikos", D))));
  });

  it("functions/today-get/handler.gen.js is the current bundle (run `pnpm bundle today-get` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "today-get", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("today-get"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
