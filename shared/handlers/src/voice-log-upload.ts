// fn:voice-log-upload (contracts/functions/voice-log-upload.json, REQ-DEB-001 / REQ-DEB-009, OPEN-04 via spike S4).
// An app recording (or a typed note) becomes exactly one tbl:voice_log:
//   1. idempotent on idempotency_key: the same key returns the same voice log with duplicate=true (offline queue resync);
//   2. audio is kept in Custom Storage (context.storage) under merc/voice-logs/<id>.<ext>; voice_log.audio_ref = that key
//      (fn:retention-purge clears it after recording_retention_days, REQ-DEB-011);
//   3. audio is transcribed inline with an audio-input chat model (S4: 39 s Greek in 2.1 s): Model Profile from global
//      MERC_TRANSCRIBE_PROFILE_ID once H3 creates `merc-transcribe`, else the proven gemini-2.5-flash compatibility alias;
//   4. the transcript is handed to fn:debrief-process (status "processing"); while that function is not deployed or
//      refuses the internal run, the voice log stays "uploaded" with its transcript, ready to be processed.
// A failed transcription is not an error response: the voice log is stored with status "failed" and its error.
import { conflict, defineFunction, globalString, invalid, isMercError, listAccounts, requireAccount, assertOwner, type FunctionContext, type Impl, type PlatformLike, type Row, type UserPrincipal, type Db } from "../../core/src/index";
import { push, repChannel, type PushPlatform, type ApiLike } from "../../live/src/index";

type Req = Parameters<Impl<"voice-log-upload">>[0]["req"];
type Res = Awaited<ReturnType<Impl<"voice-log-upload">>>;
type Log = (level: "info" | "warn" | "error", message: string, details?: Record<string, unknown>) => void;

export const SLUG = "voice-log-upload" as const;
export const DEBRIEF_SLUG = "debrief-process";
/** Global variable with the tenant Model Profile id of `merc-transcribe` (human step H3). */
export const GLOBAL_TRANSCRIBE_PROFILE = "MERC_TRANSCRIBE_PROFILE_ID";
/** S4-proven compatibility alias, used until the profile exists. */
export const FALLBACK_MODEL = "gemini-2.5-flash";
export const STORAGE_PREFIX = "merc/voice-logs/";
/** context.storage.upload() limit is 10 MB; the 1 MB platform body limit is far below it. */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

// ---------- small pure helpers ----------
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Base64 (std or url-safe, optional data: prefix) to bytes, without Node built-ins. Null if malformed. */
export function decodeBase64(input: string): Uint8Array | null {
  let s = input.trim();
  const comma = s.startsWith("data:") ? s.indexOf(",") : -1;
  if (comma >= 0) s = s.slice(comma + 1);
  s = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!s || s.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(s)) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    buf = (buf << 6) | B64.indexOf(s[i]!);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 0xff; }
  }
  return out.subarray(0, o);
}
/** The bare base64 payload (data: prefix stripped) the model wants. */
export const bareBase64 = (s: string) => { const t = s.trim(); return t.startsWith("data:") ? t.slice(t.indexOf(",") + 1) : t; };

const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/m4a": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav" };
/** Normalized mime ("audio/webm;codecs=opus" -> "audio/webm"); default audio/webm (the app's MediaRecorder default). */
export function audioMime(m: string | null | undefined): string {
  const base = (m ?? "").split(";")[0]!.trim().toLowerCase();
  if (!base) return "audio/webm";
  if (!base.startsWith("audio/") && base !== "video/webm" && base !== "video/mp4") throw invalid(`audio_mime must be an audio type, got ${base}`);
  return base === "video/webm" ? "audio/webm" : base === "video/mp4" ? "audio/mp4" : base;
}
export const storageKey = (voiceLogId: string, mime: string) => `${STORAGE_PREFIX}${voiceLogId}.${EXT[mime] ?? "bin"}`;

// ---------- dependencies (injected so tests fake the platform) ----------
export interface StorageLike {
  upload(key: string, data: Uint8Array, contentType?: string): Promise<{ key: string }> | { key: string };
  delete(key: string): Promise<void> | void;
}
export interface TranscribeInput { audio_base64: string; mime: string; language: string | null; vocabulary: string[] }
export type Transcriber = (input: TranscribeInput) => Promise<{ text: string; model: string }>;
export type DebriefRunner = (voiceLogId: string) => Promise<unknown>;
export interface UploadDeps {
  transcribe: Transcriber | null;
  storage?: StorageLike | null;
  /** Hands the transcript to fn:debrief-process. Null: not wired, the voice log stays "uploaded". */
  runDebrief?: DebriefRunner | null;
  live?: PushPlatform | null;
  log?: Log;
}
const defaultLog: Log = (level, message, details) => {
  const line = `[voice-log-upload] ${message}${details ? " " + JSON.stringify(details) : ""}`;
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
};
const msg = (e: unknown) => String((e as { message?: unknown })?.message ?? e).slice(0, 500);

/** Names the model should spell exactly (S4 caveat: proper nouns). Best effort, bounded. */
export async function vocabulary(db: Db, me: UserPrincipal): Promise<string[]> {
  const names = new Set<string>();
  try {
    for (const a of (await listAccounts(db, me, {}, { limit: 60 })).items) if (a.name) names.add(a.name);
    for (const c of (await db.competitor.list({}, { limit: 40 })).items) if (c.name) names.add(c.name);
    for (const p of (await db.product.list({}, { limit: 40 })).items) if (p.name) names.add(p.name);
  } catch { /* the hint is optional */ }
  return [...names].slice(0, 120);
}

export function transcribePrompt(language: string | null, vocab: string[]): string {
  return [
    `Transcribe this audio recording verbatim in its original language${language ? ` (expected: ${language})` : " (likely Greek)"}.`,
    "It is a field sales rep's debrief after a customer visit. Do not translate, summarize or add anything.",
    vocab.length ? `Spell these names exactly as written when you hear them: ${vocab.join(", ")}.` : "",
    "Return only the transcript text, no commentary. If there is no speech, return an empty string.",
  ].filter(Boolean).join("\n");
}

/** The runtime namespaces from @wonderful/types/langchain (index.ts passes them; tests pass fakes). */
export interface LlmRuntime {
  ModelProfiles?: { ChatModel: new (o: { profile: string; temperature?: number }) => { invoke(m: unknown[]): Promise<unknown> } };
  LangChainGoogleGenAI?: { ChatGoogleGenerativeAI: new (o: { model: string; temperature?: number }) => { invoke(m: unknown[]): Promise<unknown> } };
  LangChainCore?: { HumanMessage: new (o: { content: unknown }) => object };
}
const textOf = (res: unknown): string => {
  const c = (res as { content?: unknown })?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : typeof (p as { text?: unknown })?.text === "string" ? (p as { text: string }).text : "")).join("");
  return "";
};
/** Inline-audio transcriber: the profile (if configured) first, then the S4 compatibility alias. */
export function runtimeTranscriber(rt: LlmRuntime, profileId: string | null): Transcriber | null {
  const candidates: Array<{ model: string; make: () => { invoke(m: unknown[]): Promise<unknown> } }> = [];
  if (profileId && rt.ModelProfiles) candidates.push({ model: `profile:${profileId}`, make: () => new rt.ModelProfiles!.ChatModel({ profile: profileId, temperature: 0 }) });
  if (rt.LangChainGoogleGenAI) candidates.push({ model: FALLBACK_MODEL, make: () => new rt.LangChainGoogleGenAI!.ChatGoogleGenerativeAI({ model: FALLBACK_MODEL, temperature: 0 }) });
  if (!candidates.length) return null;
  return async ({ audio_base64, mime, language, vocabulary: vocab }) => {
    const content = [{ type: "text", text: transcribePrompt(language, vocab) }, { type: "media", mimeType: mime, data: audio_base64 }];
    const message = rt.LangChainCore ? new rt.LangChainCore.HumanMessage({ content }) : { role: "user", content };
    const errors: string[] = [];
    for (const c of candidates) {
      try { return { text: textOf(await c.make().invoke([message])).trim(), model: c.model }; }
      catch (e) { errors.push(`${c.model}: ${msg(e)}`); }
    }
    throw new Error(`transcription failed (${errors.join("; ")})`);
  };
}

// ---------- the handler ----------
async function finish(deps: UploadDeps, db: Db, row: Row<"voice_log">, duplicate: boolean): Promise<Res> {
  if (!duplicate) await push(deps.live, "voice_log.status", { voice_log_id: row.id, status: row.status, error: row.error ?? null }, repChannel(row.rep_id), { log: deps.log });
  return { voice_log_id: row.id, status: row.status, duplicate };
}

/** Steps 2-4 for a stored voice log (also used to retry a failed transcription on a resend of the same key). */
async function pipeline(deps: UploadDeps, db: Db, me: UserPrincipal, row: Row<"voice_log">, audio: { b64: string; bytes: Uint8Array; mime: string } | null): Promise<Row<"voice_log">> {
  const log = deps.log ?? defaultLog;
  if (audio && !row.audio_ref) {
    if (!deps.storage) log("warn", "context.storage unavailable: audio not kept (transcript only)", { voice_log_id: row.id });
    else {
      try {
        const info = await deps.storage.upload(storageKey(row.id, audio.mime), audio.bytes, audio.mime);
        row = await db.voice_log.update(row.id, { audio_ref: info?.key ?? storageKey(row.id, audio.mime) });
      } catch (e) { log("warn", "audio not stored", { voice_log_id: row.id, error: msg(e) }); }
    }
  }
  if (!row.transcript) {
    if (!audio) return db.voice_log.update(row.id, { status: "failed", error: "no audio and no transcript" });
    if (!deps.transcribe) return db.voice_log.update(row.id, { status: "failed", error: "transcription unavailable: no audio-capable model runtime in this function" });
    row = await db.voice_log.update(row.id, { status: "transcribing", error: null });
    try {
      const t = await deps.transcribe({ audio_base64: audio.b64, mime: audio.mime, language: row.language ?? me.org.default_language ?? null, vocabulary: await vocabulary(db, me) });
      if (!t.text) return db.voice_log.update(row.id, { status: "failed", error: "transcription returned no speech" });
      row = await db.voice_log.update(row.id, { transcript: t.text, status: "uploaded", error: null });
      log("info", "transcribed", { voice_log_id: row.id, model: t.model, chars: t.text.length });
    } catch (e) {
      return db.voice_log.update(row.id, { status: "failed", error: msg(e) });
    }
  }
  if (!deps.runDebrief) return row.status === "uploaded" ? row : db.voice_log.update(row.id, { status: "uploaded" });
  row = await db.voice_log.update(row.id, { status: "processing", error: null });
  let refusal: string | null = null;
  try {
    const out = await deps.runDebrief(row.id);
    const err = (out as { error?: { code?: string; message?: string } } | null)?.error ?? (out as { result?: { error?: { code?: string; message?: string } } } | null)?.result?.error;
    if (err) refusal = `${err.code ?? "error"}: ${err.message ?? ""}`.trim();
  } catch (e) { refusal = msg(e); }
  const now = (await db.voice_log.get(row.id)) ?? row;
  if (refusal && now.status === "processing") {
    log("warn", "debrief-process did not take the voice log; left as uploaded", { voice_log_id: row.id, reason: refusal });
    return db.voice_log.update(row.id, { status: "uploaded", error: `debrief pending: ${refusal}`.slice(0, 500) });
  }
  return now;
}

export function makeImpl(deps: UploadDeps): Impl<"voice-log-upload"> {
  return async ({ req, db, me }) => {
    const key = req.idempotency_key.trim();
    if (!key || key.length > 200) throw invalid("idempotency_key must be 1-200 characters");
    const transcript = req.transcript?.trim() || null;
    const b64 = req.audio_base64?.trim() || null;
    let audio: { b64: string; bytes: Uint8Array; mime: string } | null = null;
    if (b64) {
      const bytes = decodeBase64(b64);
      if (!bytes || bytes.length === 0) throw invalid("audio_base64 is not valid base64");
      if (bytes.length > MAX_AUDIO_BYTES) throw invalid(`audio is larger than ${MAX_AUDIO_BYTES} bytes`);
      audio = { b64: bareBase64(b64), bytes, mime: audioMime(req.audio_mime) };
    }

    // REQ-DEB-009: the same key is the same voice log. voice_log is not org-scoped, so the key is global.
    const existing = await db.voice_log.findOne({ idempotency_key: key });
    if (existing) return resend(existing);

    if (!audio && !transcript) throw invalid("send audio_base64 or transcript");
    let accountId = req.account_id ?? null;
    if (accountId) await requireAccount(db, me, accountId); // REQ-CORE-009
    const visitId = req.visit_id ?? null;
    if (visitId) {
      const visit = await db.visit.require(visitId);
      assertOwner(me, visit.rep_id, "visit");
      if (accountId && visit.account_id !== accountId) throw invalid("visit_id belongs to another account");
      accountId = accountId ?? visit.account_id;
      if (accountId) await requireAccount(db, me, accountId);
    }

    let row: Row<"voice_log">;
    try {
      row = await db.voice_log.insert({
        rep_id: me.id, account_id: accountId, visit_id: visitId,
        capture_mode: audio ? "offline_recording" : "typed",
        language: req.language?.trim() || null, audio_ref: null, transcript,
        status: audio && !transcript ? "transcribing" : "uploaded",
        idempotency_key: key, recorded_at: new Date(req.recorded_at).toISOString(),
      } as any);
    } catch (e) {
      // Lost a race with a concurrent resend of the same key: answer as the duplicate.
      if (isMercError(e) && e.code === "conflict") {
        const again = await db.voice_log.findOne({ idempotency_key: key });
        if (again) return resend(again);
      }
      throw e;
    }
    return finish(deps, db, await pipeline(deps, db, me, row, audio), false);

    async function resend(found: Row<"voice_log">): Promise<Res> {
      if (found.rep_id !== me.id) throw conflict("idempotency_key is already used by another voice log", { field: "idempotency_key" });
      // A resend after a failed transcription retries it on the same voice log (offline sync, REQ-DEB-009).
      if (found.status === "failed" && !found.transcript && audio) {
        const retried = await pipeline(deps, db, me, found, audio);
        await push(deps.live, "voice_log.status", { voice_log_id: retried.id, status: retried.status, error: retried.error ?? null }, repChannel(retried.rep_id), { log: deps.log });
        return { voice_log_id: retried.id, status: retried.status, duplicate: true };
      }
      return { voice_log_id: found.id, status: found.status, duplicate: true };
    }
  };
}

// ---------- the deployed entry ----------
type FunctionsLike = { run(o: { slug: string; params?: Record<string, unknown> }): unknown };
export type UploadContext = FunctionContext & { storage?: StorageLike | null; api?: ApiLike | null; functions?: FunctionsLike | null };

/** Deps from the platform context. `rt` is @wonderful/types/langchain (functions/voice-log-upload/index.ts passes it). */
export function depsFromContext(context: UploadContext, rt: LlmRuntime = globalThis as unknown as LlmRuntime): UploadDeps {
  const platform: PlatformLike = { globals: (context as PlatformLike).globals ?? null };
  const fns = context.functions;
  return {
    transcribe: runtimeTranscriber(rt, globalString(platform, GLOBAL_TRANSCRIBE_PROFILE)),
    storage: context.storage ?? null,
    live: { api: context.api ?? null },
    runDebrief: fns && typeof fns.run === "function" ? async (id) => fns.run({ slug: DEBRIEF_SLUG, params: { voice_log_id: id } }) : null,
  };
}

export const handle = (context: UploadContext, rt?: LlmRuntime) => defineFunction(SLUG, makeImpl(depsFromContext(context, rt)))(context);
