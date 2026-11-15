import { validateEvent, type EventType, type MercEvent } from "../contracts";

/** Minimal WebSocket surface (browser WebSocket or a test fake). */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  close(): void;
}

export type LiveMode = "connecting" | "socket" | "polling";

export interface LiveOptions {
  /** Opens fn:merc-live. Omit (mock mode, external link) to poll only. */
  openSocket?: () => SocketLike;
  /** Event types the screen listens to (app.json `events`). */
  types: readonly EventType[];
  onEvent: (event: MercEvent<EventType>) => void;
  /** Refetch used while the socket is down (REQ-CORE-011). */
  poll?: () => unknown;
  /** Poll interval; 5 s keeps a result card within the 10 s budget. */
  pollMs?: number;
  /** Delay before reopening a dropped socket. */
  retryMs?: number;
  onMode?: (mode: LiveMode) => void;
}

/** Subscribe to merc-live events; falls back to polling while the socket is unavailable. Returns an unsubscribe. */
export function subscribeLive(opts: LiveOptions): () => void {
  const pollMs = opts.pollMs ?? 5000;
  const retryMs = opts.retryMs ?? 15000;
  let stopped = false;
  let ws: SocketLike | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const setMode = (m: LiveMode) => opts.onMode?.(m);
  const startPolling = () => {
    if (stopped || pollTimer) return;
    setMode("polling");
    void opts.poll?.();
    pollTimer = setInterval(() => void opts.poll?.(), pollMs);
  };
  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };
  const dropped = (sock: SocketLike) => {
    if (stopped || ws !== sock) return;
    ws = null;
    startPolling();
    if (opts.openSocket && !retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, retryMs);
    }
  };
  const connect = () => {
    if (stopped) return;
    if (!opts.openSocket) return startPolling();
    let sock: SocketLike;
    try {
      sock = opts.openSocket();
    } catch {
      ws = null;
      startPolling();
      return;
    }
    ws = sock;
    if (!pollTimer) setMode("connecting");
    sock.onopen = () => {
      if (ws !== sock) return;
      stopPolling();
      setMode("socket");
    };
    sock.onmessage = (ev) => {
      let msg: unknown;
      try {
        msg = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      } catch {
        return;
      }
      const v = validateEvent(msg);
      if (v.ok && opts.types.includes((msg as MercEvent<EventType>).type)) opts.onEvent(msg as MercEvent<EventType>);
    };
    sock.onerror = () => dropped(sock);
    sock.onclose = () => dropped(sock);
  };

  connect();
  return () => {
    stopped = true;
    stopPolling();
    if (retryTimer) clearTimeout(retryTimer);
    const s = ws;
    ws = null;
    s?.close();
  };
}
