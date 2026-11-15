import { describe, expect, it } from "vitest";
import { callStructured, PROFILE_IDS, type ModelFactory, type ChatModelLike } from "../src/index.js";
import { debriefInput, debriefOutput } from "./fixtures.js";

/** Fake model: returns (or throws) the queued replies in order and records each call. */
function fake(replies: unknown[]) {
  const calls: { profile: string; schema: Record<string, unknown>; messages: { content: string }[] }[] = [];
  const factory: ModelFactory = (profile) => ({
    withStructuredOutput: (schema) => ({
      invoke: async (messages) => {
        calls.push({ profile, schema, messages: messages as { content: string }[] });
        const r = replies.shift();
        if (r instanceof Error) throw r;
        return r;
      },
    }),
  }) as ChatModelLike;
  return { factory, calls };
}

describe("callStructured", () => {
  it("returns a valid output in one attempt on the contract's profile", async () => {
    const m = fake([debriefOutput()]);
    const r = await callStructured("debrief_extraction", debriefInput, { model: m.factory });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(m.calls[0].profile).toBe(PROFILE_IDS["merc-extract"]);
    expect(JSON.stringify(m.calls[0].schema)).not.toContain("$ref");
    expect(m.calls[0].messages[0].content).toContain("evidence must be a substring");
  });

  it("rejects an invalid input without calling the model", async () => {
    const m = fake([debriefOutput()]);
    const r = await callStructured("debrief_extraction", { ...debriefInput, today: "tomorrow" } as never, { model: m.factory });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("validation_failed");
    expect(r.attempts).toBe(0);
    expect(m.calls.length).toBe(0);
  });

  it("retries once with the validation errors, then succeeds", async () => {
    const bad = { ...debriefOutput(), visit_done: "yes" };
    const m = fake([bad, debriefOutput()]);
    const r = await callStructured("debrief_extraction", debriefInput, { model: m.factory });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    const retry = m.calls[1].messages;
    expect(retry.length).toBe(3);
    expect(retry[2].content).toContain("/visit_done must be boolean");
  });

  it("fails with validation_failed after two invalid outputs (no third call)", async () => {
    const m = fake([{ note: "x" }, { note: "y" }, debriefOutput()]);
    const r = await callStructured("debrief_extraction", debriefInput, { model: m.factory });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("validation_failed");
    expect(r.attempts).toBe(2);
    expect(m.calls.length).toBe(2);
  });

  it("retries a model error and maps a double failure to upstream_failed", async () => {
    const ok = fake([new Error("overloaded"), JSON.stringify(debriefOutput())]);
    const r1 = await callStructured("debrief_extraction", debriefInput, { model: ok.factory });
    expect(r1.ok && r1.attempts).toBe(2);
    const ko = fake([new Error("a"), new Error("b")]);
    const r2 = await callStructured("debrief_extraction", debriefInput, { model: ko.factory });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe("upstream_failed");
  });

  it("honours a profile override", async () => {
    const m = fake([debriefOutput()]);
    await callStructured("debrief_extraction", debriefInput, { model: m.factory, profile: "merc-write" });
    expect(m.calls[0].profile).toBe(PROFILE_IDS["merc-write"]);
  });
});
