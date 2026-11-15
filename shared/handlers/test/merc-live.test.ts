import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateRequest, validateResponse } from "../../core/src/index";
import { connect, connectRequest, impl, main } from "../src/merc-live";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const CONTRACT = JSON.parse(readFileSync(join(__dirname, "../../../spec/contracts/functions/merc-live.json"), "utf8"));
const conn = (query: Record<string, unknown>) => ({ type: "connect" as const, connectionId: "c-1", headers: {}, query });

describe("fn:merc-live (REQ-CORE-011)", () => {
  it("contract: WS, no gate, app caller; request/response validate against spec/contracts/functions/merc-live.json", () => {
    expect([CONTRACT.method, CONTRACT.gate, CONTRACT.callers]).toEqual(["WS", null, ["app"]]);
    expect(validateRequest("merc-live", { connect_query: { client: "rep" } }).ok).toBe(true);
    expect(validateRequest("merc-live", { connect_query: { client: "boss" } }).ok).toBe(false);
    expect(validateRequest("merc-live", {}).ok).toBe(false);
    expect(validateResponse("merc-live", { channels: [`rep:${IDS.nikos}`] }).ok).toBe(true);
    expect(validateResponse("merc-live", { channels: "rep:x" }).ok).toBe(false);
  });

  it("connect: a rep joins rep:{id}; a manager also joins team:{id} (seed users)", async () => {
    const t = kit();
    expect(await main(t.fnCtx("nikos"), conn({ client: "rep" }))).toEqual({ ok: true, channels: [`rep:${IDS.nikos}`] });
    expect(await main(t.fnCtx("eleni"), conn({ client: "mgmt" }))).toEqual({ ok: true, channels: [`rep:${IDS.eleni}`, `team:${IDS.eleni}`] });
    const r = ok(await connect(t.fnCtx("dimitra"), { client: "rep" }));
    expect(validateResponse("merc-live", r).ok).toBe(true);
    expect(r.channels).toEqual([`rep:${IDS.dimitra}`]);
  });

  it("connect stores the channels in the connection kv", async () => {
    const t = kit();
    const kv = new Map<string, unknown>();
    const ctx = Object.assign(t.fnCtx("nikos"), { kv: { set: (k: string, v: unknown) => kv.set(k, v) } });
    await main(ctx, conn({ client: "rep" }));
    expect(kv.get("channels")).toEqual([`rep:${IDS.nikos}`]);
  });

  it("refuses with {ok:false, reason}: no platform user, unknown user, bad or missing client", async () => {
    const t = kit();
    const anon = (await main(t.fnCtx(null), conn({ client: "rep" }))) as any;
    expect(anon.ok).toBe(false);
    expect(anon.reason).toMatch(/^forbidden: /);
    const ctx = t.fnCtx(null);
    (ctx.metadata as any).user = { id: "wuid-nobody" };
    expect(((await main(ctx, conn({ client: "rep" }))) as any).reason).toMatch(/^forbidden: /);
    expect(((await main(t.fnCtx("nikos"), conn({ client: "boss" }))) as any).reason).toMatch(/^validation_failed: /);
    expect(((await main(t.fnCtx("nikos"), conn({}))) as any).ok).toBe(false);
  });

  it("identity only from the platform: query params cannot choose channels or user (REQ-CORE-002)", async () => {
    const t = kit();
    expect(connectRequest({ client: "rep", user_id: IDS.eleni, channels: "team:x", _t: "1" })).toEqual({ connect_query: { client: "rep" } });
    expect(await main(t.fnCtx("nikos"), conn({ client: "mgmt", user_id: IDS.eleni, caller: { user_id: IDS.eleni } }))).toEqual({ ok: true, channels: [`rep:${IDS.nikos}`] });
    expect(connectRequest({ client: ["rep", "mgmt"] })).toEqual({ connect_query: { client: "rep" } });
  });

  it("impl is the same rule the connect step runs", async () => {
    const t = kit();
    expect(await impl({ req: { connect_query: { client: "mgmt" } }, db: t.db, me: await t.principal("eleni"), platform: {} })).toEqual({ channels: [`rep:${IDS.eleni}`, `team:${IDS.eleni}`] });
  });

  it("message: ping -> pong; anything else -> validation error frame; disconnect -> {}", async () => {
    const t = kit();
    const pong = (await main(t.fnCtx("nikos"), { type: "message", connectionId: "c-1", data: { type: "ping" } })) as any;
    expect(pong.type).toBe("pong");
    expect(Number.isNaN(Date.parse(pong.at))).toBe(false);
    expect(errCode(await main(t.fnCtx("nikos"), { type: "message", connectionId: "c-1", data: { type: "result_card.ready" } }))).toBe("validation_failed");
    expect(await main(t.fnCtx("nikos"), { type: "disconnect", connectionId: "c-1", code: 1000 })).toEqual({});
    expect(errCode(await main(t.fnCtx("nikos"), { type: "bogus", connectionId: "c-1" } as any))).toBe("validation_failed");
    expect(errCode(await main(t.fnCtx("nikos"), null))).toBe("validation_failed");
  });

  it("a draft Run event (params as the event, no connectionId) is one client frame, never a connect", async () => {
    const t = kit();
    expect(((await main(t.fnCtx("nikos"), { type: "ping" })) as any).type).toBe("pong");
    expect(errCode(await main(t.fnCtx("nikos"), { type: "connect", query: { client: "rep" } }))).toBe("validation_failed");
  });

  it("functions/merc-live: SOCKET config and current bundle (run `pnpm bundle merc-live` after changes)", async () => {
    const cfg = JSON.parse(readFileSync(join(FUNCTIONS, "merc-live", "config.json"), "utf8"));
    expect([cfg.method, cfg.path_slug]).toEqual(["SOCKET", "merc-live"]);
    expect(readFileSync(join(FUNCTIONS, "merc-live", "index.ts"), "utf8")).toMatch(/async function main\(context: any, event: any\)/);
    const committed = readFileSync(join(FUNCTIONS, "merc-live", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("merc-live"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
