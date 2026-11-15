import type { FunctionRequestMap, FunctionResponseMap } from "../../../contracts";

/**
 * Offline recording queue (REQ-APP-003, REQ-DEB-009).
 * A recording is stored with a stable idempotency_key before any network call, so a retry after a dropped
 * connection (or a reload) uploads the same key and the server answers duplicate=true with the same voice log.
 */
export type QueueStatus =
  /** saved on the phone, not uploaded yet */
  | "queued"
  /** upload in flight */
  | "uploading"
  /** server has the voice log; waiting for the result card */
  | "processing"
  /** result card received */
  | "ready"
  /** permanent failure (validation, forbidden, pipeline failed): needs the rep */
  | "failed";

export interface QueueItem {
  idempotency_key: string;
  recorded_at: string;
  account_id: string | null;
  audio_base64: string | null;
  audio_mime: string | null;
  transcript: string | null;
  language: string | null;
  duration_ms: number | null;
  status: QueueStatus;
  attempts: number;
  voice_log_id: string | null;
  duplicate: boolean;
  error: string | null;
  updated_at: string;
}

export type UploadRequest = FunctionRequestMap["voice-log-upload"];
export type UploadResponse = FunctionResponseMap["voice-log-upload"];
export type Upload = (req: UploadRequest) => Promise<UploadResponse>;

/** Platform body limit is 1 MB; base64 adds 4/3, leave room for the JSON envelope. */
export const MAX_BODY_BYTES = 1_000_000;
export const MAX_AUDIO_BASE64 = 960_000;
/** Recordings older than this that are done (ready/failed) are dropped from the list. */
export const KEEP_DONE_MS = 24 * 3600 * 1000;
export const STORAGE_KEY = "merc.record.queue.v1";

/** Error codes that will not change on retry: the item is marked failed instead of retried. */
const PERMANENT = new Set(["validation_failed", "forbidden", "blocked_by_policy", "not_found", "conflict"]);

export function newIdempotencyKey(rand: () => string = defaultRandom): string {
  return `rec-${rand()}`;
}
function defaultRandom(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createItem(input: {
  audio_base64?: string | null;
  audio_mime?: string | null;
  transcript?: string | null;
  account_id?: string | null;
  language?: string | null;
  duration_ms?: number | null;
  now?: Date;
  key?: string;
}): QueueItem {
  const now = (input.now ?? new Date()).toISOString();
  const audio = input.audio_base64 ?? null;
  const transcript = input.transcript?.trim() ? input.transcript.trim() : null;
  if (!audio && !transcript) throw new Error("empty recording");
  if (audio && audio.length > MAX_AUDIO_BASE64) throw new Error("recording too large");
  return {
    idempotency_key: input.key ?? newIdempotencyKey(),
    recorded_at: now,
    account_id: input.account_id ?? null,
    audio_base64: audio,
    audio_mime: audio ? (input.audio_mime ?? "audio/webm") : null,
    transcript,
    language: input.language ?? null,
    duration_ms: input.duration_ms ?? null,
    status: "queued",
    attempts: 0,
    voice_log_id: null,
    duplicate: false,
    error: null,
    updated_at: now,
  };
}

export function toUploadRequest(item: QueueItem): UploadRequest {
  return {
    idempotency_key: item.idempotency_key,
    recorded_at: item.recorded_at,
    account_id: item.account_id,
    visit_id: null,
    audio_base64: item.audio_base64,
    audio_mime: item.audio_mime,
    transcript: item.transcript,
    language: item.language,
  };
}

const errCode = (e: unknown): string | undefined => {
  const c = (e as { code?: unknown })?.code;
  return typeof c === "string" ? c : undefined;
};
const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface FlushResult {
  items: QueueItem[];
  uploaded: number;
  /** true when a transient error stopped the flush (probably offline); retry later. */
  stalled: boolean;
}

/**
 * Upload every queued item, oldest first, one at a time. A transient error (network, timeout, upstream)
 * stops the flush and leaves the item queued; a permanent error marks only that item failed.
 * `onChange` receives the list after each step so the UI and storage follow along.
 */
export async function flushQueue(
  items: readonly QueueItem[],
  upload: Upload,
  opts: { online?: boolean; now?: () => Date; onChange?: (items: QueueItem[]) => void } = {},
): Promise<FlushResult> {
  const now = opts.now ?? (() => new Date());
  let list = items.map((i) => (i.status === "uploading" ? { ...i, status: "queued" as const } : i));
  if (opts.online === false) return { items: list, uploaded: 0, stalled: true };
  let uploaded = 0;
  const order = [...list].filter((i) => i.status === "queued").sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const set = (key: string, patch: Partial<QueueItem>) => {
    list = list.map((i) => (i.idempotency_key === key ? { ...i, ...patch, updated_at: now().toISOString() } : i));
    opts.onChange?.(list);
  };
  for (const item of order) {
    set(item.idempotency_key, { status: "uploading", attempts: item.attempts + 1 });
    try {
      const res = await upload(toUploadRequest(item));
      const failed = res.status === "failed";
      set(item.idempotency_key, {
        status: failed ? "failed" : "processing",
        voice_log_id: res.voice_log_id,
        duplicate: res.duplicate,
        // The server has the audio now; drop the phone copy so storage stays small.
        audio_base64: null,
        error: failed ? "failed" : null,
      });
      uploaded++;
    } catch (e) {
      const code = errCode(e);
      if (code && PERMANENT.has(code)) {
        set(item.idempotency_key, { status: "failed", error: `${code}: ${errMessage(e)}` });
        continue;
      }
      set(item.idempotency_key, { status: "queued", error: errMessage(e) });
      return { items: list, uploaded, stalled: true };
    }
  }
  return { items: list, uploaded, stalled: false };
}

/** Apply a voice_log.status event (or a poll answer) to the item with that voice log. */
export function applyVoiceLogStatus(items: readonly QueueItem[], voiceLogId: string, status: string, error?: string | null): QueueItem[] {
  return items.map((i) => {
    if (i.voice_log_id !== voiceLogId) return i;
    if (status === "failed") return { ...i, status: "failed", error: error ?? "failed" };
    if (status === "processed" || status === "ready" || status === "done") return { ...i, status: "ready", error: null };
    return i.status === "ready" ? i : { ...i, status: "processing" };
  });
}

export const markReady = (items: readonly QueueItem[], voiceLogId: string): QueueItem[] =>
  items.map((i) => (i.voice_log_id === voiceLogId ? { ...i, status: "ready", error: null } : i));

/** Put a failed item back in the queue (only possible while the phone still has its audio or transcript). */
export const retryItem = (items: readonly QueueItem[], key: string): QueueItem[] =>
  items.map((i) =>
    i.idempotency_key === key && i.status === "failed" && (i.audio_base64 || i.transcript || i.voice_log_id === null)
      ? { ...i, status: "queued", error: null }
      : i,
  );

export const removeItem = (items: readonly QueueItem[], key: string): QueueItem[] => items.filter((i) => i.idempotency_key !== key);

/** Drop finished items older than KEEP_DONE_MS; never drops anything still waiting to upload. */
export function pruneQueue(items: readonly QueueItem[], now: Date = new Date()): QueueItem[] {
  return items.filter((i) => !(i.status === "ready" || i.status === "failed") || now.getTime() - Date.parse(i.updated_at) < KEEP_DONE_MS);
}

export const pendingCount = (items: readonly QueueItem[]): number => items.filter((i) => i.status === "queued" || i.status === "uploading").length;

/* ---------- persistence ---------- */

export interface QueueStore {
  load(): QueueItem[];
  /** false when the phone could not keep it (quota): the UI warns that the recording only lives in this tab. */
  save(items: readonly QueueItem[]): boolean;
}

const isItem = (v: unknown): v is QueueItem =>
  !!v && typeof v === "object" && typeof (v as QueueItem).idempotency_key === "string" && typeof (v as QueueItem).status === "string";

export function parseQueue(raw: string | null): QueueItem[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter(isItem) : [];
  } catch {
    return [];
  }
}

export function localQueueStore(key = STORAGE_KEY, storage: () => Storage | undefined = () => globalThis.localStorage): QueueStore {
  let memory: QueueItem[] | null = null;
  return {
    load() {
      if (memory) return memory;
      try {
        return parseQueue(storage()?.getItem(key) ?? null);
      } catch {
        return [];
      }
    },
    save(items) {
      memory = [...items];
      try {
        const s = storage();
        if (!s) return false;
        s.setItem(key, JSON.stringify(items));
        memory = null;
        return true;
      } catch {
        return false;
      }
    },
  };
}
