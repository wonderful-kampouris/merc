import { describe, expect, it } from "vitest";
import { openMercLive, unencodeLiveQuery } from "./liveSocket";

describe("openMercLive", () => {
  it("keeps ?client= unencoded in the socket URL the SDK builds, then restores WebSocket", () => {
    const seen: string[] = [];
    class FakeWS { constructor(u: string) { seen.push(u); } }
    const g = { WebSocket: FakeWS as never };
    const sdkOpen = (slug: string) => new (g.WebSocket as any)(`wss://h/app-function-sockets/TOKEN/${encodeURIComponent(slug)}`);
    const ws = openMercLive(sdkOpen, "rep", g);
    expect(seen).toEqual(["wss://h/app-function-sockets/TOKEN/merc-live?client=rep"]);
    expect(ws).toBeInstanceOf(FakeWS);
    expect(g.WebSocket).toBe(FakeWS);
  });
  it("leaves other URLs alone", () => {
    expect(unencodeLiveQuery("wss://h/x/orders%3Fa")).toBe("wss://h/x/orders%3Fa");
  });
});
