import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsSystem, validateResponse } from "../../core/src/index";
import { handle, makeImpl } from "../src/retention-purge";
import { kit, ok, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const NOW = Date.parse("2026-11-16T03:00:00Z"); // seed org: recording_retention_days = 30
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

async function setup() {
  const t = kit();
  const files = new Set<string>();
  const mk = async (key: string, daysAgo: number, rep: string = IDS.nikos, audio = true) => {
    const ref = audio ? `merc/voice-logs/${key}.webm` : null;
    if (ref) files.add(ref);
    return t.db.voice_log.insert({ rep_id: rep, capture_mode: "offline_recording", status: "completed", idempotency_key: key, recorded_at: iso(daysAgo), audio_ref: ref, transcript: `transcript ${key}` } as any);
  };
  const storage = { delete: async (k: string) => { if (k.includes("broken")) throw new Error("other: backend 503"); if (!files.delete(k)) throw new Error("not-found"); } };
  return { t, files, mk, storage };
}

describe("fn:retention-purge (REQ-DEB-011)", () => {
  it("clears audio_ref and deletes the stored audio past retention; transcripts and recent audio are kept", async () => {
    const { t, files, mk, storage } = await setup();
    const old = await mk("old", 31);
    const recent = await mk("recent", 29);
    const typed = await mk("typed", 40, IDS.nikos, false);
    const out = ok(await runAsSystem("retention-purge", makeImpl({ storage, now: () => NOW }), { tables: t.tables, data: {}, orgId: IDS.org }));
    expect(validateResponse("retention-purge", out).ok).toBe(true);
    expect(out).toMatchObject({ processed: 1, created: 0, details: { retention_days: 30, purged: 1, dry_run: false, failed: [] } });
    expect((await t.db.voice_log.get(old.id))!).toMatchObject({ audio_ref: null, transcript: "transcript old" });
    expect((await t.db.voice_log.get(recent.id))!.audio_ref).toBe("merc/voice-logs/recent.webm");
    expect((await t.db.voice_log.get(typed.id))!.audio_ref).toBeNull();
    expect([...files]).toEqual(["merc/voice-logs/recent.webm"]);
  });

  it("dry_run only counts; an already-missing file still clears the ref; a failing delete keeps it for the next run", async () => {
    const { t, files, mk, storage } = await setup();
    const a = await mk("a", 60);
    const gone = await mk("gone", 60); files.delete("merc/voice-logs/gone.webm");
    const broken = await mk("broken", 60);
    const impl = makeImpl({ storage, now: () => NOW });
    const dry = ok(await runAsSystem("retention-purge", impl, { tables: t.tables, data: { dry_run: true }, orgId: IDS.org }));
    expect(dry).toMatchObject({ processed: 3, details: { dry_run: true, purged: 0, would_purge: 3 } });
    expect((await t.db.voice_log.get(a.id))!.audio_ref).not.toBeNull();
    const real = ok(await runAsSystem("retention-purge", impl, { tables: t.tables, data: {}, orgId: IDS.org }));
    expect(real.details).toMatchObject({ purged: 2, failed: [{ voice_log_id: broken.id, error: expect.stringContaining("503") }] });
    expect((await t.db.voice_log.get(gone.id))!.audio_ref).toBeNull();
    expect((await t.db.voice_log.get(broken.id))!.audio_ref).toBe("merc/voice-logs/broken.webm");
  });

  it("without storage nothing is cleared (no orphaned files)", async () => {
    const { t, mk } = await setup();
    const a = await mk("a", 60);
    const none = ok(await runAsSystem("retention-purge", makeImpl({ storage: null, now: () => NOW }), { tables: t.tables, data: {}, orgId: IDS.org }));
    expect(none.details).toMatchObject({ purged: 0, failed: [{ voice_log_id: a.id }] });
    expect((await t.db.voice_log.get(a.id))!.audio_ref).not.toBeNull();
  });

  it("the cron entry runs once per organization with a system principal and validates the request", async () => {
    const { t, files, mk } = await setup();
    await mk("old", 3650);
    const storage = { delete: async (k: string) => { files.delete(k); } };
    const out = await handle(Object.assign(t.fnCtx(null, {}), { storage }));
    expect(out).toMatchObject({ slug: "retention-purge", orgs: 1, failed: 0, runs: [{ org_id: IDS.org, outcome: { processed: 1, details: { purged: 1 } } }] });
    const bad = await handle(Object.assign(t.fnCtx(null, { dry_run: "yes" }), { storage }));
    expect(bad).toMatchObject({ failed: 1, runs: [{ outcome: { error: { code: "validation_failed" } } }] });
  });

  it("functions/retention-purge/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "retention-purge", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("retention-purge"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
