import { describe, expect, it } from "vitest";
import { GREETING, openingLine, scriptOf } from "../tools/call_opening/index";

describe("call_opening line", () => {
  it("a \"call me\" callback opens with why we called, then the brief", () => {
    expect(openingLine({ kind: "buddy_call", purpose: "callback", first_name: "Nikos" }, "Five stops today. First, Café Miltos."))
      .toBe("Hi Nikos, you asked me to call. Here's your day. Five stops today. First, Café Miltos.");
  });
  it("drops the brief's own greeting so the call does not say hi twice", () => {
    expect(openingLine({ kind: "buddy_call", purpose: "callback", first_name: "Nikos" }, "Hi Nikos! Here's your briefing. Stop 1 is Café Miltos."))
      .toBe("Hi Nikos, you asked me to call. Here's your day. Stop 1 is Café Miltos.");
  });
  it("no brief available still says why we called; other calls keep the greeting", () => {
    expect(openingLine({ kind: "buddy_call", purpose: "callback", first_name: null }, null)).toBe("Hi, you asked me to call. What do you need?");
    expect(openingLine({ kind: "buddy_call", purpose: "approval_decided", reason: "Eleni approved 8% for Fournos Kostas", first_name: "Nikos" }, null))
      .toBe("Hi Nikos, Merc here. Eleni approved 8% for Fournos Kostas.");
    expect(openingLine({ kind: "inbound" }, null)).toBe(GREETING);
  });
  it("reads script_text from wrapped and plain results, null on error", () => {
    expect(scriptOf({ result: { script_text: " Brief " } })).toBe("Brief");
    expect(scriptOf({ script_text: "Brief" })).toBe("Brief");
    expect(scriptOf({ error: { code: "x" } })).toBeNull();
  });
});
