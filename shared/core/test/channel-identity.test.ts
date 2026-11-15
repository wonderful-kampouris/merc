import { describe, expect, it } from "vitest";
import { callerFromTool, createDb, normalizePhone, principalFromTool } from "../src/index";
import { seeded, IDS } from "./fake-tables";

const KEY = "test-internal-call-key";
const rej = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as any; } throw new Error("expected rejection"); };
const phoneCtx = (tables: any, c: Record<string, unknown>) => ({ tables, metadata: { communication: { metadata: {}, ...c } } });

describe("phone / WhatsApp identity (REQ-BUD-013)", () => {
  it("normalizes Greek numbers to E.164", () => {
    expect(normalizePhone("+30 697 123 4567")).toBe("+306971234567");
    expect(normalizePhone("00306971234567")).toBe("+306971234567");
    expect(normalizePhone("6971234567")).toBe("+306971234567");
    expect(normalizePhone("whatsapp:+306971234567")).toBe("+306971234567");
    expect(normalizePhone("sip:+306971234567@x.sip.example")).toBe("+306971234567");
    expect(normalizePhone("anonymous")).toBeNull();
  });

  it("uses fromNumber inbound and toNumber outbound", () => {
    expect(callerFromTool(phoneCtx(null, { type: "voice", direction: "inbound", fromNumber: "+306971234567", toNumber: "+302100000000" }), KEY))
      .toEqual({ kind: "channel_number", number: "+306971234567", channel: "phone" });
    expect(callerFromTool(phoneCtx(null, { type: "voice", direction: "outbound", fromNumber: "+302100000000", toNumber: "+306971234567" }), KEY))
      .toEqual({ kind: "channel_number", number: "+306971234567", channel: "phone" });
    expect(callerFromTool(phoneCtx(null, { type: "whatsapp", direction: "inbound", fromNumber: "306971234567" }), KEY).kind).toBe("channel_number");
  });

  it("does not fall back to the number on browser/chat sessions", () => {
    expect(() => callerFromTool(phoneCtx(null, { type: "chat", fromNumber: "+306971234567" }), KEY)).toThrow();
  });

  it("resolves exactly one active user with the channel enabled", async () => {
    const f = seeded();
    const db = createDb(f, IDS.org);
    await db.app_user.update(IDS.nikos, { phone: "+306971234567" });
    const ctx = phoneCtx(f, { type: "voice", direction: "inbound", fromNumber: "+30 697 123 4567" });
    expect((await principalFromTool(f, ctx as any, KEY)).id).toBe(IDS.nikos);

    await db.app_user.update(IDS.nikos, { phone_channel_enabled: false });
    expect((await rej(principalFromTool(f, ctx as any, KEY))).code).toBe("forbidden");
    await db.app_user.update(IDS.nikos, { phone_channel_enabled: true });

    await db.app_user.update(IDS.dimitra, { phone: "+306971234567" });
    expect((await rej(principalFromTool(f, ctx as any, KEY))).code).toBe("forbidden");

    const stranger = phoneCtx(f, { type: "voice", direction: "inbound", fromNumber: "+306900000000" });
    expect((await rej(principalFromTool(f, stranger as any, KEY))).message).toMatch(/does not know this number/);
  });
});
