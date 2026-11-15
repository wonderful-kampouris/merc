import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";
import { makeHandle, type DebriefDeps } from "../src/debrief-process";
import { handle, impl } from "../src/debrief-result-get";
import { J1, j1Output } from "../../../evals/debrief/j1";

const d: DebriefDeps = {
  now: () => Date.parse("2026-11-16T10:00:00Z"),
  extract: async () => ({ ok: true, value: j1Output(), attempts: 1, profile: "fake", logs: [] }),
  draftModel: () => ({ withStructuredOutput: () => ({ invoke: async () => ({ subject: "Ευχαριστώ", body: "Καλησπέρα Μίλτο, ευχαριστώ. Νίκος" }) }) }),
};

describe("fn:debrief-result-get", () => {
  it("contract: GET, gate voicelog.read, app+buddy", () => {
    const c = JSON.parse(readFileSync(join(__dirname, "../../../spec/contracts/functions/debrief-result-get.json"), "utf8"));
    expect([c.method, c.gate, c.callers]).toEqual(["GET", "voicelog.read", ["app", "buddy"]]);
    expect(validateRequest("debrief-result-get", { voice_log_id: IDS.miltos }).ok).toBe(true);
    expect(validateRequest("debrief-result-get", {}).ok).toBe(false);
  });

  it("returns the same card debrief-process produced (polling path, REQ-CORE-011)", async () => {
    const t = kit();
    const pushed = ok(await makeHandle(d)(t.fnCtx("nikos", { utterance: J1, account_id: IDS.miltos }) as never)).result!;
    const polled = ok(await handle(t.fnCtx("nikos", { voice_log_id: pushed.voice_log_id })));
    expect(validateResponse("debrief-result-get", polled).ok).toBe(true);
    expect(polled.lines).toEqual(pushed.lines);
    expect(polled.missing_fields).toEqual(pushed.missing_fields);
    expect(polled.pending_approvals.map((a) => a.approval_id)).toEqual(pushed.pending_approvals.map((a) => a.approval_id));
    expect(polled.spoken_summary).toBe(pushed.spoken_summary);
    expect(ok(await runAsTool("debrief-result-get", impl, t.toolCtx("nikos"), { voice_log_id: pushed.voice_log_id }, t.key))).toEqual(polled);
    // admin sees it; another rep and the manager do not (scope owner; OPEN-13: managers see results via dashboards)
    expect(ok(await handle(t.fnCtx("thanasis", { voice_log_id: pushed.voice_log_id }))).voice_log_id).toBe(pushed.voice_log_id);
    expect(errCode(await handle(t.fnCtx("dimitra", { voice_log_id: pushed.voice_log_id })))).toBe("forbidden");
  });

  it("not ready -> not_found with the status; unknown id -> not_found; no user -> forbidden", async () => {
    const t = kit();
    const vl = await t.db.voice_log.insert({ rep_id: IDS.nikos, capture_mode: "typed", status: "processing", idempotency_key: "k-1", recorded_at: "2026-11-16T10:00:00.000Z", transcript: "x" } as never);
    const out = await handle(t.fnCtx("nikos", { voice_log_id: vl.id }));
    expect(errCode(out)).toBe("not_found");
    expect((out as any).error.details.status).toBe("processing");
    expect(errCode(await handle(t.fnCtx("nikos", { voice_log_id: "00000000-0000-4000-8000-000000000000" })))).toBe("not_found");
    expect(errCode(await handle(t.fnCtx(null, { voice_log_id: vl.id })))).toBe("forbidden");
  });

  it("functions/debrief-result-get/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "debrief-result-get", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("debrief-result-get"))).toBe(true);
  });
});
