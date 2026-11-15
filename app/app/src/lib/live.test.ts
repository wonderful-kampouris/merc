import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockEvent } from "../contracts";
import { subscribeLive, type LiveMode, type SocketLike } from "./live";

class FakeSocket implements SocketLike {
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onerror: SocketLike["onerror"] = null;
  onclose: SocketLike["onclose"] = null;
  closed = false;
  close() {
    this.closed = true;
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("merc-live with polling fallback (REQ-CORE-011)", () => {
  it("delivers validated events of the subscribed types over the socket", () => {
    const sock = new FakeSocket();
    const got: string[] = [];
    const modes: LiveMode[] = [];
    const stop = subscribeLive({ openSocket: () => sock, types: ["result_card.ready"], onEvent: (e) => got.push(e.type), onMode: (m) => modes.push(m) });
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify(mockEvent("result_card.ready")) });
    sock.onmessage?.({ data: JSON.stringify(mockEvent("alert.created")) });
    sock.onmessage?.({ data: JSON.stringify({ type: "result_card.ready", at: "x", payload: {} }) });
    sock.onmessage?.({ data: "not json" });
    expect(got).toEqual(["result_card.ready"]);
    expect(modes).toEqual(["connecting", "socket"]);
    stop();
    expect(sock.closed).toBe(true);
  });

  it("polls every 5 s while the socket is down and stops polling when it reconnects", () => {
    const socks: FakeSocket[] = [];
    const poll = vi.fn();
    const modes: LiveMode[] = [];
    const stop = subscribeLive({
      openSocket: () => {
        const s = new FakeSocket();
        socks.push(s);
        return s;
      },
      types: ["result_card.ready"],
      onEvent: () => {},
      poll,
      retryMs: 12000,
      onMode: (m) => modes.push(m),
    });
    socks[0]!.onerror?.({});
    socks[0]!.onclose?.({});
    expect(poll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10000);
    expect(poll).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(2000); // retry opens a new socket
    expect(socks).toHaveLength(2);
    socks[1]!.onopen?.({});
    const n = poll.mock.calls.length;
    vi.advanceTimersByTime(20000);
    expect(poll).toHaveBeenCalledTimes(n);
    expect(modes).toEqual(["connecting", "polling", "socket"]);
    stop();
  });

  it("polls only when there is no socket (mock mode) or opening throws", () => {
    const poll = vi.fn();
    const stop = subscribeLive({ types: ["alert.created"], onEvent: () => {}, poll });
    vi.advanceTimersByTime(5000);
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
    const poll2 = vi.fn();
    const stop2 = subscribeLive({ openSocket: () => { throw new Error("blocked"); }, types: ["alert.created"], onEvent: () => {}, poll: poll2 });
    expect(poll2).toHaveBeenCalledTimes(1);
    stop2();
  });
});
