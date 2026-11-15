import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LLM_META, eventContracts, firstValid, functionContracts, functionSlugs, llmContracts, seedOrder, type LlmSchemaName,
} from "../src/index.js";

const contracts = join(import.meta.dirname, "../../../spec/contracts");
const list = (d: string) => readdirSync(join(contracts, d)).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
const read = (d: string, f: string) => JSON.parse(readFileSync(join(contracts, d, f), "utf8"));

describe("counts are derived from spec/contracts", () => {
  it("functions, events, llm and seed tables match the contract folders", () => {
    expect(functionSlugs()).toEqual(list("functions").map((f) => read("functions", f).slug).sort());
    expect(Object.keys(functionContracts).length).toBe(list("functions").length);
    expect(Object.keys(eventContracts).sort()).toEqual(list("events").map((f) => read("events", f).type).sort());
    expect(Object.keys(llmContracts).sort()).toEqual(list("llm").map((f) => read("llm", f).name).sort());
    expect(seedOrder).toEqual(JSON.parse(readFileSync(join(contracts, "seed/_order.json"), "utf8")));
  });
});

describe("llm export includes purpose, rules, eval_set", () => {
  it.each(list("llm"))("%s", (f) => {
    const d = read("llm", f);
    const name = d.name as LlmSchemaName;
    for (const k of ["purpose", "rules", "eval_set", "profile", "used_by"]) {
      expect(llmContracts[name][k], k).toEqual(d[k]);
      expect((LLM_META[name] as unknown as Record<string, unknown>)[k], k).toEqual(d[k]);
    }
    expect(typeof LLM_META[name].purpose).toBe("string");
    expect(Array.isArray(LLM_META[name].rules)).toBe(true);
    expect(LLM_META[name].eval_set).toMatch(/^evals\//);
  });
});

describe("mock fallbacks are validated", () => {
  const ok = { ok: true } as const;
  const bad = (e: string) => ({ ok: false, errors: [e] }) as const;
  it("returns the seeded candidate when valid", () => {
    expect(firstValid((s) => (s ? "seed" : "plain"), () => ok, {}, "x")).toBe("seed");
  });
  it("falls back to the seedless candidate only if it validates", () => {
    expect(firstValid((s) => (s ? "seed" : "plain"), (v) => (v === "plain" ? ok : bad("seed bad")), {}, "x")).toBe("plain");
  });
  it("throws when the fallback is invalid too, naming both errors", () => {
    expect(() => firstValid(() => 1, () => bad("nope"), {}, "llm thing")).toThrow(/llm thing: useSeed=true: nope \| useSeed=false: nope/);
  });
  it("useSeed=false tries only the seedless candidate", () => {
    const seen: boolean[] = [];
    expect(() => firstValid((s) => seen.push(s), () => bad("e"), { useSeed: false }, "x")).toThrow();
    expect(seen).toEqual([false]);
  });
});
