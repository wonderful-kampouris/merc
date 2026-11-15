import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runFunction, validateRequest, validateResponse } from "../../core/src/index";
import { handle, makeImpl, decodeBase64, audioMime, storageKey, runtimeTranscriber, depsFromContext, inProcessDebrief, type UploadDeps, type LlmRuntime } from "../src/voice-log-upload";
import { makeImpl as makeDebrief } from "../src/debrief-process";
import type { DebriefOutput } from "../../llm/src/index";
import { J1, j1Output } from "../../../evals/debrief/j1";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const AUDIO = Buffer.from("fake-opus-bytes-0123456789").toString("base64");
const BODY = (over: Record<string, unknown> = {}) => ({ idempotency_key: "k-1", recorded_at: "2026-11-16T09:30:00Z", account_id: IDS.miltos, audio_base64: AUDIO, audio_mime: "audio/webm;codecs=opus", ...over });

function fakes(over: Partial<UploadDeps> = {}) {
  const files = new Map<string, Uint8Array>();
  const calls = { transcribe: 0, debrief: 0, pushes: [] as unknown[] };
  const deps: UploadDeps = {
    transcribe: async ({ mime, vocabulary }) => { calls.transcribe++; expect(mime).toBe("audio/webm"); expect(vocabulary.length).toBeGreaterThan(0); return { text: "Ήμουν στο καφέ, θέλει 12 κιλά.", model: "fake" }; },
    storage: { upload: async (k, d) => { if (files.has(k)) throw new Error("validation-error: key in use"); files.set(k, d); return { key: k }; }, delete: async (k) => { files.delete(k); } },
    live: { api: { post: async (_p, o) => { calls.pushes.push(o?.body); return {}; } } },
    runDebrief: null,
    log: () => {},
    ...over,
  };
  return { deps, files, calls };
}
/** The deployed entry with fake deps: same path as defineFunction (validation, caller, gate, response check). */
const run = (t: ReturnType<typeof kit>, deps: UploadDeps, who: "nikos" | "dimitra" | "eleni" | null, body: unknown) => {
  const ctx = t.fnCtx(who, body);
  return runFunction("voice-log-upload", makeImpl(deps), { tables: ctx.tables, data: ctx.data, principal: () => t.principal(who as any).then((p) => { if (!who) throw new Error(); return p; }) });
};

describe("fn:voice-log-upload (REQ-DEB-001, REQ-DEB-009)", () => {
  it("stores one voice_log, keeps the audio, transcribes inline and answers per contract", async () => {
    const t = kit(); const f = fakes();
    const r = ok(await run(t, f.deps, "nikos", BODY()));
    expect(validateResponse("voice-log-upload", r).ok).toBe(true);
    expect(r).toEqual({ voice_log_id: expect.any(String), status: "uploaded", duplicate: false });
    const row = (await t.db.voice_log.get(r.voice_log_id))!;
    expect(row).toMatchObject({ rep_id: IDS.nikos, account_id: IDS.miltos, capture_mode: "offline_recording", transcript: "Ήμουν στο καφέ, θέλει 12 κιλά.", audio_ref: storageKey(r.voice_log_id, "audio/webm"), idempotency_key: "k-1" });
    expect(new TextDecoder().decode(f.files.get(row.audio_ref!))).toBe("fake-opus-bytes-0123456789");
    expect(f.calls.pushes).toEqual([{ channel: `rep:${IDS.nikos}`, data: expect.objectContaining({ type: "voice_log.status", payload: { voice_log_id: r.voice_log_id, status: "uploaded", error: null } }) }]);
  });

  it("REQ-DEB-009: the same idempotency_key twice returns duplicate=true with the same voice log, no second row or transcription", async () => {
    const t = kit(); const f = fakes();
    const a = ok(await run(t, f.deps, "nikos", BODY()));
    const b = ok(await run(t, f.deps, "nikos", BODY()));
    expect(b).toEqual({ voice_log_id: a.voice_log_id, status: a.status, duplicate: true });
    expect(await t.db.voice_log.count({ idempotency_key: "k-1" })).toBe(1);
    expect(f.calls.transcribe).toBe(1);
    expect(f.files.size).toBe(1);
  });

  it("a lost insert race (unique 500) is answered as the duplicate", async () => {
    const t = kit(); const f = fakes();
    const a = ok(await run(t, f.deps, "nikos", BODY()));
    // Simulate a concurrent resend that passed the pre-read: force the pre-read to miss once.
    let first = true;
    const deps = { ...f.deps };
    const impl = makeImpl(deps);
    const out = await runFunction("voice-log-upload", async (inv) => {
      const orig = inv.db.voice_log.findOne.bind(inv.db.voice_log);
      (inv.db.voice_log as any).findOne = async (w: any) => (first ? ((first = false), null) : orig(w));
      return impl(inv);
    }, { tables: t.tables, data: BODY(), principal: () => t.principal("nikos") });
    expect(ok(out)).toEqual({ voice_log_id: a.voice_log_id, status: "uploaded", duplicate: true });
  });

  it("another rep reusing a key gets conflict, not the other rep's voice log", async () => {
    const t = kit(); const f = fakes();
    ok(await run(t, f.deps, "nikos", BODY()));
    expect(errCode(await run(t, f.deps, "dimitra", BODY({ account_id: null })))).toBe("conflict");
  });

  it("a typed note is stored as capture_mode typed without transcription or storage", async () => {
    const t = kit(); const f = fakes();
    const r = ok(await run(t, f.deps, "nikos", BODY({ audio_base64: null, audio_mime: null, transcript: "  Πήγα στο Μίλτος. ", language: "el" })));
    const row = (await t.db.voice_log.get(r.voice_log_id))!;
    expect(row).toMatchObject({ capture_mode: "typed", transcript: "Πήγα στο Μίλτος.", language: "el", audio_ref: null, status: "uploaded" });
    expect(f.calls.transcribe).toBe(0);
  });

  it("a failed transcription stores status failed with the error; a resend of the key retries it", async () => {
    const t = kit(); let fail = true;
    const f = fakes({ transcribe: async () => { if (fail) throw new Error("model 503"); return { text: "ok now", model: "fake" }; } });
    const a = ok(await run(t, f.deps, "nikos", BODY()));
    expect(a.status).toBe("failed");
    expect((await t.db.voice_log.get(a.voice_log_id))!.error).toContain("model 503");
    fail = false;
    const b = ok(await run(t, f.deps, "nikos", BODY()));
    expect(b).toEqual({ voice_log_id: a.voice_log_id, status: "uploaded", duplicate: true });
    expect((await t.db.voice_log.get(a.voice_log_id))!.transcript).toBe("ok now");
    expect(f.files.size).toBe(1); // audio stored once
  });

  it("hands the transcript to debrief-process; a refusal leaves it uploaded with the reason", async () => {
    const t = kit();
    const seen: string[] = [];
    const okRun = fakes({ runDebrief: async (id) => { seen.push(id); await t.db.voice_log.update(id, { status: "completed" }); return { result: { voice_log_id: id } }; } });
    const a = ok(await run(t, okRun.deps, "nikos", BODY()));
    expect(seen).toEqual([a.voice_log_id]);
    expect(a.status).toBe("completed");
    const refused = fakes({ runDebrief: async () => ({ error: { code: "forbidden", message: "caller is not a Merc user" } }) });
    const b = ok(await run(t, refused.deps, "nikos", BODY({ idempotency_key: "k-2" })));
    expect(b.status).toBe("uploaded");
    expect((await t.db.voice_log.get(b.voice_log_id))!.error).toBe("debrief pending: forbidden: caller is not a Merc user");
    const thrown = fakes({ runDebrief: async () => { throw new Error("no enabled function carries the slug"); } });
    expect(ok(await run(t, thrown.deps, "nikos", BODY({ idempotency_key: "k-3" }))).status).toBe("uploaded");
  });

  it("without storage the audio is not kept but the voice log is still transcribed; without a model it fails clearly", async () => {
    const t = kit();
    const a = ok(await run(t, fakes({ storage: null }).deps, "nikos", BODY()));
    expect((await t.db.voice_log.get(a.voice_log_id))!).toMatchObject({ audio_ref: null, status: "uploaded" });
    const b = ok(await run(t, fakes({ transcribe: null }).deps, "nikos", BODY({ idempotency_key: "k-9" })));
    expect(b.status).toBe("failed");
  });

  it("scope: another rep's account or visit is forbidden (REQ-CORE-009); bad input is validation_failed", async () => {
    const t = kit(); const f = fakes();
    const other = (await t.db.account.list({ owner_rep_id: IDS.center_rep }, { limit: 1 })).items[0]!;
    expect(errCode(await run(t, f.deps, "nikos", BODY({ account_id: other.id })))).toBe("forbidden");
    const visit = (await t.db.visit.list({ rep_id: IDS.center_rep }, { limit: 1 })).items[0];
    if (visit) expect(errCode(await run(t, f.deps, "nikos", BODY({ account_id: null, visit_id: visit.id })))).toBe("forbidden");
    expect(errCode(await run(t, f.deps, "nikos", BODY({ audio_base64: null, transcript: null })))).toBe("validation_failed");
    expect(errCode(await run(t, f.deps, "nikos", BODY({ audio_base64: "not base64!!" })))).toBe("validation_failed");
    expect(errCode(await run(t, f.deps, "nikos", BODY({ audio_mime: "image/png" })))).toBe("validation_failed");
    expect(errCode(await run(t, f.deps, "nikos", BODY({ duration_ms: 3000 })))).toBe("validation_failed"); // additionalProperties:false
    expect(await t.db.voice_log.count({})).toBe(0);
  });

  it("the deployed entry: caller from the platform user, spoofed caller ignored, no user forbidden", async () => {
    const t = kit();
    const rt: LlmRuntime = { LangChainGoogleGenAI: { ChatGoogleGenerativeAI: class { async invoke() { return { content: "Καλημέρα" }; } } as any } };
    const ctx = Object.assign(t.fnCtx("nikos", { ...BODY({ account_id: null }), caller: { user_id: IDS.thanasis } }), { storage: fakes().deps.storage });
    const r = ok(await handle(ctx, rt));
    expect((await t.db.voice_log.get(r.voice_log_id))!).toMatchObject({ rep_id: IDS.nikos, transcript: "Καλημέρα" });
    expect(errCode(await handle(t.fnCtx(null, BODY()), rt))).toBe("forbidden");
  });

  it("contract: the app's request shape validates", () => {
    expect(validateRequest("voice-log-upload", { idempotency_key: "x", recorded_at: "2026-11-16T09:30:00Z", account_id: null, visit_id: null, audio_base64: AUDIO, audio_mime: "audio/webm", transcript: null, language: null }).ok).toBe(true);
  });
});

describe("voice-log-upload helpers", () => {
  it("decodeBase64 matches Buffer and rejects garbage", () => {
    for (const s of ["", "a", "ab", "abc", "hello world", "Ήμουν"]) {
      const b64 = Buffer.from(s).toString("base64");
      if (!s) { expect(decodeBase64(b64)).toBeNull(); continue; }
      expect(Buffer.from(decodeBase64(b64)!).toString()).toBe(s);
      expect(Buffer.from(decodeBase64(`data:audio/webm;base64,${b64}`)!).toString()).toBe(s);
    }
    expect(decodeBase64("@@@")).toBeNull();
  });
  it("audioMime normalizes", () => {
    expect(audioMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(audioMime(null)).toBe("audio/webm");
    expect(audioMime("video/mp4")).toBe("audio/mp4");
    expect(() => audioMime("text/plain")).toThrow();
  });
  it("runtimeTranscriber tries the profile first, then the gemini alias, and sends inline media", async () => {
    const seen: string[] = [];
    let content: any = null;
    const rt: LlmRuntime = {
      ModelProfiles: { ChatModel: class { constructor(o: any) { seen.push(`profile:${o.profile}`); } async invoke() { throw new Error("profile missing"); } } as any },
      LangChainGoogleGenAI: { ChatGoogleGenerativeAI: class { constructor(o: any) { seen.push(o.model); } async invoke(m: any[]) { content = m[0].content; return { content: [{ type: "text", text: " hi " }] }; } } as any },
      LangChainCore: { HumanMessage: class { content: unknown; constructor(o: any) { this.content = o.content; } } as any },
    };
    const tr = runtimeTranscriber(rt, "pid-1")!;
    expect(await tr({ audio_base64: "AAAA", mime: "audio/ogg", language: "el", vocabulary: ["Μίλτος"] })).toEqual({ text: "hi", model: "gemini-2.5-flash" });
    expect(seen).toEqual(["profile:pid-1", "gemini-2.5-flash"]);
    expect(content[1]).toEqual({ type: "media", mimeType: "audio/ogg", data: "AAAA" });
    expect(content[0].text).toContain("Μίλτος");
    expect(runtimeTranscriber({}, null)).toBeNull();
  });
  it("depsFromContext reads the profile global and wires the in-process debrief-process runner", () => {
    const t = kit({ globals: { MERC_TRANSCRIBE_PROFILE_ID: "pid-x" } });
    const d = depsFromContext(t.fnCtx("nikos") as any, {});
    expect(d.transcribe).toBeNull();
    expect(d.runDebrief).toBe(inProcessDebrief);
    expect(depsFromContext(t.fnCtx("nikos") as any, { ModelProfiles: { ChatModel: class {} as any } }).transcribe).not.toBeNull();
  });
});

describe("REQ-DEB-001: one recording -> one voice_log -> one result card (debrief-process in-process)", () => {
  const NOW = Date.parse("2026-11-16T10:00:00Z");
  const debriefDeps = (out: DebriefOutput | null) => ({
    now: () => NOW,
    extract: async () => (out ? { ok: true as const, value: out, attempts: 1, profile: "fake", logs: [] } : { ok: false as const, error: { code: "upstream_failed", message: "model down" }, attempts: 2, profile: "fake", logs: [] }),
    draftModel: () => ({ withStructuredOutput: () => ({ invoke: async () => ({ subject: "Ευχαριστώ", body: "Καλησπέρα Μίλτο, ευχαριστώ. Νίκος" }) }) }),
  }) as any;
  const runner = (out: DebriefOutput | null): UploadDeps["runDebrief"] => (id, inv) => makeDebrief(debriefDeps(out))({ req: { voice_log_id: id } as any, ...inv });

  it("the J1 recording transcribes and completes with a result card pushed to the rep", async () => {
    const t = kit(); const pushes: any[] = [];
    const f = fakes({ transcribe: async () => ({ text: J1, model: "fake" }), runDebrief: runner(j1Output()), live: { api: { post: async (_p: string, o: any) => { pushes.push(o?.body); return {}; } } } });
    const ctxApi = { post: async (_p: string, o: any) => { pushes.push(o?.body); return {}; } };
    const r = ok(await runFunction("voice-log-upload", makeImpl(f.deps), { tables: t.tables, data: BODY(), principal: () => t.principal("nikos"), platform: { api: ctxApi } as any }));
    expect(r).toEqual({ voice_log_id: expect.any(String), status: "completed", duplicate: false });
    expect(await t.db.voice_log.count({})).toBe(1);
    const vl = (await t.db.voice_log.get(r.voice_log_id))!;
    expect(vl).toMatchObject({ status: "completed", transcript: J1, account_id: IDS.miltos });
    expect((await t.db.ai_action.all({ voice_log_id: r.voice_log_id })).length).toBeGreaterThan(3);
    expect(pushes.filter((p) => p?.data?.type === "result_card.ready" && p.channel === `rep:${IDS.nikos}`)).toHaveLength(1);
    // the resend of the same key after completion is a pure duplicate (no second card, no second extraction)
    const again = ok(await runFunction("voice-log-upload", makeImpl(f.deps), { tables: t.tables, data: BODY(), principal: () => t.principal("nikos") }));
    expect(again).toEqual({ voice_log_id: r.voice_log_id, status: "completed", duplicate: true });
    expect(await t.db.voice_log.count({})).toBe(1);
  });

  it("a debrief model failure leaves the transcript and status failed (retryable through debrief-process)", async () => {
    const t = kit();
    const f = fakes({ transcribe: async () => ({ text: J1, model: "fake" }), runDebrief: runner(null) });
    const r = ok(await run(t, f.deps, "nikos", BODY()));
    expect(r.status).toBe("failed");
    expect((await t.db.voice_log.get(r.voice_log_id))!).toMatchObject({ transcript: J1, error: expect.stringContaining("upstream_failed") });
  });
});

describe("bundle", () => {
  it("functions/voice-log-upload/handler.gen.js is the current bundle (run `pnpm bundle voice-log-upload` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "voice-log-upload", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("voice-log-upload"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
