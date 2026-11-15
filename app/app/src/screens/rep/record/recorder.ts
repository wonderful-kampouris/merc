/** Browser audio capture for an in-app debrief (MediaRecorder, low bitrate so 3 minutes fit the 1 MB body). */
export const AUDIO_BITS_PER_SECOND = 24_000;
export const MAX_RECORDING_MS = 180_000;

const MIME_PREFERENCE = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export function pickMime(isSupported: (m: string) => boolean): string | undefined {
  return MIME_PREFERENCE.find((m) => {
    try {
      return isSupported(m);
    } catch {
      return false;
    }
  });
}

export const recordingSupported = (): boolean =>
  typeof globalThis.MediaRecorder !== "undefined" && !!globalThis.navigator?.mediaDevices?.getUserMedia;

/** "data:audio/webm;base64,AAAA" -> "AAAA". */
export const stripDataUrl = (dataUrl: string): string => {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
};

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(stripDataUrl(String(r.result)));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

export interface Recording {
  base64: string;
  mime: string;
  durationMs: number;
}

export interface RecorderHandle {
  stop(): Promise<Recording>;
  cancel(): void;
}

/** Ask for the mic and start recording. Rejects with the browser error (NotAllowedError when denied). */
export async function startRecording(onAutoStop?: () => void): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mime = pickMime((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
  const chunks: Blob[] = [];
  const started = Date.now();
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const release = () => stream.getTracks().forEach((t) => t.stop());
  const timer = setTimeout(() => onAutoStop?.(), MAX_RECORDING_MS);
  rec.start(1000);
  return {
    stop: () =>
      new Promise<Recording>((resolve, reject) => {
        clearTimeout(timer);
        rec.onstop = async () => {
          release();
          try {
            const type = rec.mimeType || mime || "audio/webm";
            const blob = new Blob(chunks, { type });
            resolve({ base64: await blobToBase64(blob), mime: type.split(";")[0]!, durationMs: Date.now() - started });
          } catch (e) {
            reject(e);
          }
        };
        if (rec.state !== "inactive") rec.stop();
      }),
    cancel: () => {
      clearTimeout(timer);
      rec.onstop = release;
      if (rec.state !== "inactive") rec.stop();
      else release();
    },
  };
}

export const formatDuration = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
