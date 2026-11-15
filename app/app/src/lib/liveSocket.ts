// Opens fn:merc-live through the App SDK. The SDK URL-encodes the slug, so "merc-live?client=rep" becomes the
// unknown path ".../merc-live%3Fclient%3Drep" and the platform drops the socket (1006); the bare slug is refused too.
// Seen on Team Delta 2026-11-15: only the unencoded "/merc-live?client=rep" opens (and answers ping with pong).
// So the WebSocket constructor is wrapped only for the synchronous SDK call, restoring the query string.
type Ctor = new (url: string | URL, protocols?: string | string[]) => WebSocket;

export function unencodeLiveQuery(url: string): string {
  return url.replace(/\/merc-live%3Fclient%3D([a-z]+)$/i, "/merc-live?client=$1");
}

export function openMercLive(open: (slug: string) => unknown, client: "rep" | "mgmt", g: { WebSocket: Ctor } = globalThis as never): unknown {
  const Orig = g.WebSocket;
  const Fixed = function (url: string | URL, protocols?: string | string[]) {
    const u = unencodeLiveQuery(String(url));
    return protocols === undefined ? new Orig(u) : new Orig(u, protocols);
  } as unknown as Ctor;
  (Fixed as unknown as { prototype: unknown }).prototype = Orig.prototype;
  Object.assign(Fixed, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  g.WebSocket = Fixed;
  try {
    return open(`merc-live?client=${client}`);
  } finally {
    g.WebSocket = Orig;
  }
}
