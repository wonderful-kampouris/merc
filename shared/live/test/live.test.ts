import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, principalFromFunction, systemPrincipal } from "../../core/src/index";
import { seeded, IDS } from "../../core/testing/fake-tables";
import { buildEvent, channelsFor, EVENT_TYPES, push, PUSH_PATH, pushToRepAndTeams, repChannel, teamChannel, teamChannelsOf, validateEvent, type ApiLike, type Logger } from "../src/index";

const EVENTS_DIR = join(__dirname, "../../../spec/contracts/events");
const NOW = () => Date.parse("2026-11-16T09:40:00Z");
const VL = "11111111-2222-4333-8444-555555555555";
const ok = { voice_log_id: VL, status: "processing" };

function fakeApi(fail?: (body: any) => unknown) {
  const calls: Array<{ path: string; body: any }> = [];
  const api: ApiLike = { post: async (path, o) => { calls.push({ path, body: o?.body }); const e = fail?.(o?.body); if (e) throw e; return { ok: true }; } };
  return { api, calls };
}
function logs() { const lines: Array<[string, string]> = []; const log: Logger = (l, m) => { lines.push([l, m]); }; return { lines, log }; }
const wuid = (k: string) => ({ metadata: { user: { id: `wuid-${k}` } } });

describe("shared/live channels (contracts/functions/merc-live.json notes)", () => {
  it("rep gets rep:{id}; manager also team:{id}; admin rep:{id}; system none", async () => {
    const t = seeded();
    const nikos = await principalFromFunction(t, wuid("nikos"));
    const eleni = await principalFromFunction(t, wuid("eleni"));
    const thanasis = await principalFromFunction(t, wuid("thanasis"));
    expect(channelsFor(nikos)).toEqual([`rep:${IDS.nikos}`]);
    expect(channelsFor(eleni)).toEqual([`rep:${IDS.eleni}`, `team:${IDS.eleni}`]);
    expect(channelsFor(thanasis)).toEqual([`rep:${IDS.thanasis}`]);
    expect(channelsFor(await systemPrincipal(t, IDS.org, "scheduler"))).toEqual([]);
  });

  it("teamChannelsOf walks the manager chain (direct manager of a rep is eleni)", async () => {
    const db = createDb(seeded(), IDS.org);
    expect(await teamChannelsOf(db, IDS.nikos)).toContain(teamChannel(IDS.eleni));
    expect(await teamChannelsOf(db, IDS.eleni)).not.toContain(teamChannel(IDS.eleni));
    expect(await teamChannelsOf(db, "00000000-0000-4000-8000-000000000000")).toEqual([]);
  });
});

describe("shared/live events (contracts/events/*.json)", () => {
  it("knows exactly the event contracts in spec/contracts/events", () => {
    const files = readdirSync(EVENTS_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
    expect(EVENT_TYPES).toEqual(files);
    for (const f of files) expect(JSON.parse(readFileSync(join(EVENTS_DIR, `${f}.json`), "utf8")).type).toBe(f);
  });

  it("validates the envelope {type, at, payload} and each payload schema", () => {
    expect(validateEvent(buildEvent("voice_log.status", ok, NOW))).toEqual({ ok: true });
    expect(buildEvent("voice_log.status", ok, NOW).at).toBe("2026-11-16T09:40:00.000Z");
    expect(validateEvent({ type: "nope", at: "2026-11-16T09:40:00Z", payload: {} }).ok).toBe(false);
    expect(validateEvent({ type: "voice_log.status", at: "yesterday", payload: ok }).ok).toBe(false);
    expect(validateEvent({ type: "voice_log.status", at: "2026-11-16T09:40:00Z", payload: ok, extra: 1 }).ok).toBe(false);
    const bad = validateEvent({ type: "voice_log.status", at: "2026-11-16T09:40:00Z", payload: { voice_log_id: "not-a-uuid", status: "x" } });
    expect(bad.ok).toBe(false);
    expect(validateEvent({ type: "briefing.ready", at: "2026-11-16T07:45:00Z", payload: { briefing_id: VL, date: "2026-11-16" } }).ok).toBe(true);
    expect(validateEvent({ type: "manager_call.status", at: "2026-11-16T07:45:00Z", payload: { approval_id: VL, outcome: "ringing" } }).ok).toBe(true);
    expect(validateEvent({ type: "manager_call.status", at: "2026-11-16T07:45:00Z", payload: { approval_id: VL, outcome: "maybe" } }).ok).toBe(false);
  });
});

describe("shared/live push", () => {
  it("posts {channel, data: envelope} to /v1/function-sockets/messages once per (deduped) target", async () => {
    const { api, calls } = fakeApi();
    const r = await push({ api }, "voice_log.status", ok, [repChannel(IDS.nikos), repChannel(IDS.nikos), { connection_id: "c-1" }], { now: NOW, log: logs().log });
    expect(r).toMatchObject({ pushed: true, sent: 2, failed: 0 });
    expect(calls).toEqual([
      { path: PUSH_PATH, body: { channel: `rep:${IDS.nikos}`, data: { type: "voice_log.status", at: "2026-11-16T09:40:00.000Z", payload: ok } } },
      { path: PUSH_PATH, body: { connection_id: "c-1", data: { type: "voice_log.status", at: "2026-11-16T09:40:00.000Z", payload: ok } } },
    ]);
    expect(validateEvent(calls[0]!.body.data)).toEqual({ ok: true });
  });

  it("an invalid event or a malformed channel is rejected before anything is sent", async () => {
    const { api, calls } = fakeApi();
    const l = logs();
    const r = await push({ api }, "voice_log.status", { voice_log_id: "x" } as any, repChannel(IDS.nikos), { log: l.log });
    expect(r).toMatchObject({ pushed: false, reason: "invalid_event" });
    expect((await push({ api }, "voice_log.status", ok, "rep:nikos", { log: l.log })).reason).toBe("invalid_event");
    expect((await push({ api }, "voice_log.status", ok, [], { log: l.log })).reason).toBe("no_targets");
    expect(calls).toHaveLength(0);
    expect(l.lines.every(([lvl]) => lvl === "error")).toBe(true);
  });

  it("degrades to a logged no-op without a service account (no context.api, or 'not configured')", async () => {
    const l = logs();
    expect(await push({}, "voice_log.status", ok, repChannel(IDS.nikos), { log: l.log })).toMatchObject({ pushed: false, sent: 0, reason: "no_service_account" });
    expect(await push(null, "voice_log.status", ok, repChannel(IDS.nikos), { log: l.log })).toMatchObject({ reason: "no_service_account" });
    const err = Object.assign(new Error("context.api POST /v1/function-sockets/messages failed with 400: context.api is not configured: set a service account on this function"), { status: 400 });
    const { api } = fakeApi(() => err);
    expect(await push({ api }, "voice_log.status", ok, [repChannel(IDS.nikos), teamChannel(IDS.eleni)], { log: l.log })).toMatchObject({ pushed: false, sent: 0, failed: 2, reason: "no_service_account" });
    expect(l.lines.map(([lvl, m]) => [lvl, m.includes("service account")])).toEqual([["warn", true], ["warn", true], ["warn", true]]);
  });

  it("never throws: other platform errors are logged per target and reported", async () => {
    const l = logs();
    const { api } = fakeApi((b) => (b.channel === teamChannel(IDS.eleni) ? Object.assign(new Error("forbidden"), { status: 403 }) : null));
    const r = await push({ api }, "voice_log.status", ok, [repChannel(IDS.nikos), teamChannel(IDS.eleni)], { log: l.log });
    expect(r).toMatchObject({ pushed: false, sent: 1, failed: 1, reason: "upstream_failed" });
    expect(r.errors![0]).toContain("403");
  });

  it("pushToRepAndTeams reaches the rep and the manager team channel (seed data)", async () => {
    const db = createDb(seeded(), IDS.org);
    const { api, calls } = fakeApi();
    const r = await pushToRepAndTeams({ api }, db, IDS.nikos, "voice_log.status", ok, { log: logs().log });
    expect(r.pushed).toBe(true);
    expect(calls.map((c) => c.body.channel)).toEqual([repChannel(IDS.nikos), teamChannel(IDS.eleni)]);
  });
});
