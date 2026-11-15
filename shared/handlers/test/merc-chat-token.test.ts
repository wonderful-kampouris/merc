import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { callerFromTool, defineFunction, validateResponse } from "../../core/src/index";
import { handle, makeImpl, toIso, DEFAULT_API_URL, SIGN_PATH, type FetchLike } from "../src/merc-chat-token";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const ALL = { secrets: { MERC_CHAT_API_KEY: "api-key-test", MERC_INTERNAL_CALL_KEY: { value: "internal-key-test" } }, globals: { MERC_BUDDY_AGENT_ID: "agent-123" }, workspaceId: "ws-1" };
const NOW = Date.parse("2026-11-16T07:00:00Z");

function fakeFetch(reply: { status?: number; body: unknown } | Error) {
  const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    return { ok: status < 400, status, json: async () => reply.body };
  };
  return { fetch, calls };
}
const entry = (fetch: FetchLike) => defineFunction("merc-chat-token", makeImpl({ fetch, now: () => NOW }));

describe("fn:merc-chat-token (REQ-BUD-002)", () => {
  it("is blocked with a clear error while MERC_CHAT_API_KEY is missing", async () => {
    const t = kit({ secrets: { MERC_INTERNAL_CALL_KEY: "k" }, globals: ALL.globals });
    const out: any = await handle(t.fnCtx("nikos"));
    expect(out.error).toMatchObject({ code: "blocked_by_policy", details: { missing: "MERC_CHAT_API_KEY", kind: "secret" } });
    expect(out.error.message).toMatch(/MERC_CHAT_API_KEY is not set/);
    expect(out.error.details.how).toMatch(/Chat\/Create/);
  });

  it("names the next missing piece: internal key, then the buddy agent id", async () => {
    expect((await handle(kit({ secrets: { MERC_CHAT_API_KEY: "a" } }).fnCtx("nikos")) as any).error.details.missing).toBe("MERC_INTERNAL_CALL_KEY");
    expect((await handle(kit({ secrets: ALL.secrets }).fnCtx("nikos")) as any).error.details.missing).toBe("MERC_BUDDY_AGENT_ID");
  });

  it("caller must be a signed-in Merc user with voicelog.create; blocked only after that", async () => {
    expect(errCode(await handle(kit().fnCtx(null)))).toBe("forbidden");
    expect(errCode(await handle(kit().fnCtx("nikos")))).toBe("blocked_by_policy");
  });

  it("mints via POST /api/v1/jwt/sign with the API key and HMAC-signed identity claims", async () => {
    const t = kit(ALL);
    const f = fakeFetch({ body: { data: { jwt: "jwt-abc", expiresAt: "2026-11-16T08:00:00Z" }, status: 200 } });
    const r = ok(await entry(f.fetch)(t.fnCtx("nikos", { caller: { user_id: IDS.thanasis } })));
    expect(r).toEqual({ token: "jwt-abc", expires_at: "2026-11-16T08:00:00.000Z", agent_id: "agent-123" });
    expect(validateResponse("merc-chat-token", r).ok).toBe(true);
    expect(f.calls).toHaveLength(1);
    const { url, init } = f.calls[0]!;
    expect(url).toBe(`${DEFAULT_API_URL}${SIGN_PATH}`);
    expect(init.headers).toMatchObject({ Authorization: "Bearer api-key-test", "X-Workspace-Id": "ws-1" });
    const body = JSON.parse(init.body);
    expect(body.user).toEqual({ id: IDS.nikos, display_name: expect.any(String) });
    expect(body.expiresIn).toBe(3600);
    // the spoofed body caller never reaches the claims; the claims verify as the buddy tools will verify them
    const caller = callerFromTool({ metadata: { communication: { metadata: body.metadata } } }, "internal-key-test", NOW);
    expect(caller).toEqual({ kind: "app_user", appUserId: IDS.nikos, orgId: IDS.org });
    expect(Number(body.metadata.merc_exp)).toBe(NOW / 1000 + 3600);
  });

  it("accepts a bare response and a base URL override; maps platform failures to upstream_failed", async () => {
    const t = kit({ ...ALL, globals: { ...ALL.globals, MERC_PLATFORM_API_URL: "https://api.example.test/" } });
    const bare = fakeFetch({ body: { jwt: "j2", expiresAt: 1795334400 } });
    const r = ok(await entry(bare.fetch)(t.fnCtx("nikos")));
    expect(r.token).toBe("j2");
    expect(r.expires_at).toBe("2026-11-22T08:00:00.000Z");
    expect(bare.calls[0]!.url).toBe("https://api.example.test/api/v1/jwt/sign");
    const denied: any = await entry(fakeFetch({ status: 401, body: { error: "invalid api key" } }).fetch)(t.fnCtx("nikos"));
    expect(denied.error).toMatchObject({ code: "upstream_failed", details: { status: 401 } });
    expect(denied.error.message).toMatch(/invalid api key/);
    expect(errCode(await entry(fakeFetch(new Error("network down")).fetch)(t.fnCtx("nikos")))).toBe("upstream_failed");
    expect(errCode(await entry(fakeFetch({ body: { data: {}, status: 200 } }).fetch)(t.fnCtx("nikos")))).toBe("upstream_failed");
  });

  it("toIso normalizes epoch seconds, ms and strings", () => {
    expect(toIso(1795334400)).toBe("2026-11-22T08:00:00.000Z");
    expect(toIso(1795334400000)).toBe("2026-11-22T08:00:00.000Z");
    expect(toIso("1795334400")).toBe("2026-11-22T08:00:00.000Z");
    expect(toIso("nope")).toBeNull();
  });

  it("functions/merc-chat-token/handler.gen.js is the current bundle", async () => {
    const committed = readFileSync(join(FUNCTIONS, "merc-chat-token", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("merc-chat-token"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
