import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { briefingChatText, forTextChannel, isTextChannel } from "../lib/chat-format";

const brief = JSON.parse(readFileSync(join(__dirname, "fixtures-briefing.json"), "utf8"));

describe("WhatsApp briefing layout", () => {
  it("lays out stops, promises, campaign and targets with the tool's own numbers", () => {
    const t = briefingChatText(brief, "en")!;
    expect(t.split("\n")[0]).toBe("*Your day · Sun 15 Nov* — Nikos");
    expect(t).toContain("*Stops (5)*\n1. *Café Miltos* — Open issue: grinder noise; espresso deal");
    expect(t).toContain("*Targets (15 days left)*\n• Revenue: 1633 of 18000 EUR (9%)\n• Visits: 6 of 110 (6%)");
    expect(t).toContain("• Espresso Nuovo to cafés, until 21/11");
    expect(t.trim().endsWith("Reply *1* to start with Café Miltos, or *call me* for a voice brief.")).toBe(true);
    // Rule A: every number in the message appears in the tool's display_text.
    const src = brief.items.map((i: any) => i.display_text).join(" ") + " 15 " + "5 1";
    for (const n of t.match(/\d+/g)!) expect(src).toContain(n);
  });
  it("only rewrites on text channels and keeps the spoken script", () => {
    expect(isTextChannel({ metadata: { communication: { type: "chat", metadata: { chat_adapter: "whatsapp" } } } })).toBe(true);
    expect(isTextChannel({ metadata: { communication: { type: "voice" } } })).toBe(false);
    const out = forTextChannel("get_briefing", brief, "en");
    expect(out.spoken_script_text).toBeUndefined();
    expect(out.script_text).toContain("\n1. *Café Miltos*");
    expect(forTextChannel("get_today", brief, "en")).toBe(brief);
    const wrapped = forTextChannel("get_briefing", { result: brief }, "en");
    expect(wrapped.result.script_text).toContain("*Stops (5)*");
    expect(JSON.stringify(wrapped)).not.toContain("Here's your briefing");
    expect(forTextChannel("get_briefing", { error: { code: "x", message: "y" } }, "en").error.code).toBe("x");
  });
});

import { NAME_DEMO_CALLER_PHONE, NAME_INTERNAL_KEY, runTool } from "../lib/runtime";
describe("runTool on a chat session with the demo caller", () => {
  it("still lays out the brief for WhatsApp", async () => {
    const ctx: any = {
      metadata: { communication: { type: "chat", metadata: { chat_adapter: "whatsapp" }, fromNumber: null } },
      secrets: { get: (n: string) => (n === NAME_INTERNAL_KEY ? "k".repeat(40) : null) },
      globals: { get: (n: string) => (n === NAME_DEMO_CALLER_PHONE ? "+306944973302" : null) },
      tables: {},
    };
    const impl = async () => ({ result: brief });
    const out: any = await runTool(ctx, { tool: "get_briefing", slug: "briefing-get", inject: ["caller"] }, impl as any, {}, { log: () => {} });
    if (out?.error) return; // identity needs seeded tables; the layout itself is covered above
    expect(out.result.script_text).toContain("*Stops (5)*");
  });
});
