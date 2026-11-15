import { describe, expect, it } from "vitest";
import {
  applyVoiceLogStatus,
  createItem,
  flushQueue,
  localQueueStore,
  MAX_AUDIO_BASE64,
  markReady,
  parseQueue,
  pendingCount,
  pruneQueue,
  retryItem,
  toUploadRequest,
  type QueueItem,
  type Upload,
} from "./queue";
import { validateRequest } from "../../../contracts";

const at = (m: number) => new Date(Date.UTC(2026, 10, 15, 9, m));
const item = (key: string, m: number, extra: Partial<QueueItem> = {}): QueueItem => ({
  ...createItem({ transcript: `visit ${key}`, now: at(m), key }),
  ...extra,
});
const err = (code: string, message = code) => Object.assign(new Error(message), { code });

describe("record queue", () => {
  it("creates a queued item with a stable key and a contract-valid upload body", () => {
    const i = createItem({ audio_base64: "AAAA", audio_mime: "audio/webm", now: at(0), language: "el" });
    expect(i.status).toBe("queued");
    expect(i.idempotency_key).toMatch(/^rec-/);
    const v = validateRequest("voice-log-upload", toUploadRequest(i) as unknown as Record<string, unknown>);
    expect(v.ok).toBe(true);
  });

  it("rejects empty and over-size recordings (1 MB body limit)", () => {
    expect(() => createItem({ transcript: "  " })).toThrow("empty recording");
    expect(() => createItem({ audio_base64: "A".repeat(MAX_AUDIO_BASE64 + 1) })).toThrow("recording too large");
  });

  it("uploads oldest first, drops the phone audio copy, records voice_log_id", async () => {
    const calls: string[] = [];
    const upload: Upload = async (r) => {
      calls.push(r.idempotency_key);
      return { voice_log_id: `00000000-0000-4000-8000-00000000000${calls.length}`, status: "received", duplicate: false };
    };
    const items = [item("b", 2, { audio_base64: "BBBB", audio_mime: "audio/webm" }), item("a", 1)];
    const res = await flushQueue(items, upload);
    expect(calls).toEqual(["a", "b"]);
    expect(res.uploaded).toBe(2);
    expect(res.stalled).toBe(false);
    expect(res.items.every((i) => i.status === "processing" && i.voice_log_id && i.audio_base64 === null)).toBe(true);
  });

  it("does nothing while offline and keeps everything queued", async () => {
    let called = false;
    const res = await flushQueue([item("a", 1)], async () => {
      called = true;
      throw new Error("x");
    }, { online: false });
    expect(called).toBe(false);
    expect(res.stalled).toBe(true);
    expect(pendingCount(res.items)).toBe(1);
  });

  it("a network error stops the flush and keeps the item (and its key) for the next try", async () => {
    let n = 0;
    const upload: Upload = async () => {
      n++;
      throw new TypeError("Failed to fetch");
    };
    const res = await flushQueue([item("a", 1), item("b", 2)], upload);
    expect(n).toBe(1);
    expect(res.stalled).toBe(true);
    expect(res.items.map((i) => i.status)).toEqual(["queued", "queued"]);
    expect(res.items[0]!.attempts).toBe(1);
    expect(res.items[0]!.idempotency_key).toBe("a");
  });

  it("a permanent error fails only that item and continues", async () => {
    const upload: Upload = async (r) => {
      if (r.idempotency_key === "a") throw err("validation_failed", "bad body");
      return { voice_log_id: "00000000-0000-4000-8000-000000000002", status: "received", duplicate: false };
    };
    const res = await flushQueue([item("a", 1), item("b", 2)], upload);
    expect(res.items.find((i) => i.idempotency_key === "a")!.status).toBe("failed");
    expect(res.items.find((i) => i.idempotency_key === "b")!.status).toBe("processing");
  });

  it("re-upload after a lost reply reuses the key; duplicate=true lands on the same voice log (REQ-DEB-009)", async () => {
    const server = new Map<string, string>();
    const upload: Upload = async (r) => {
      const existing = server.get(r.idempotency_key);
      if (existing) return { voice_log_id: existing, status: "received", duplicate: true };
      server.set(r.idempotency_key, "00000000-0000-4000-8000-0000000000aa");
      throw new TypeError("connection reset"); // server stored it, reply lost
    };
    const first = await flushQueue([item("a", 1)], upload);
    expect(first.items[0]!.status).toBe("queued");
    const second = await flushQueue(first.items, upload);
    expect(second.items[0]).toMatchObject({ status: "processing", duplicate: true, voice_log_id: "00000000-0000-4000-8000-0000000000aa" });
    expect(server.size).toBe(1);
  });

  it("an item left 'uploading' by a reload is retried", async () => {
    const res = await flushQueue([item("a", 1, { status: "uploading" })], async () => ({ voice_log_id: "00000000-0000-4000-8000-000000000001", status: "received", duplicate: true }));
    expect(res.items[0]!.status).toBe("processing");
  });

  it("follows voice_log.status and result_card.ready", () => {
    const items = [item("a", 1, { status: "processing", voice_log_id: "v1" })];
    expect(applyVoiceLogStatus(items, "v1", "failed", "stt failed")[0]).toMatchObject({ status: "failed", error: "stt failed" });
    expect(applyVoiceLogStatus(items, "v1", "transcribing")[0]!.status).toBe("processing");
    expect(applyVoiceLogStatus(items, "other", "failed")[0]!.status).toBe("processing");
    expect(markReady(items, "v1")[0]!.status).toBe("ready");
  });

  it("retry re-queues only failed items that were never uploaded", () => {
    const items = [item("a", 1, { status: "failed" }), item("b", 2, { status: "ready", voice_log_id: "v" })];
    const r = retryItem(retryItem(items, "a"), "b");
    expect(r.map((i) => i.status)).toEqual(["queued", "ready"]);
  });

  it("prunes old finished items but never pending ones", () => {
    const old = { updated_at: at(0).toISOString() };
    const items = [item("a", 0, { ...old, status: "ready" }), item("b", 0, { ...old, status: "queued" })];
    const later = new Date(at(0).getTime() + 25 * 3600 * 1000);
    expect(pruneQueue(items, later).map((i) => i.idempotency_key)).toEqual(["b"]);
  });

  it("persists across reloads and reports quota failures", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } as unknown as Storage;
    const s = localQueueStore("k", () => storage);
    expect(s.save([item("a", 1)])).toBe(true);
    expect(localQueueStore("k", () => storage).load()[0]!.idempotency_key).toBe("a");
    const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } } as unknown as Storage;
    const f = localQueueStore("k", () => full);
    expect(f.save([item("a", 1)])).toBe(false);
    expect(f.load()).toHaveLength(1); // kept in memory for this tab
    expect(parseQueue("not json")).toEqual([]);
  });
});
