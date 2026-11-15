import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { llmRules } from "../src/rules.generated.js";
import { llmContract, llmContracts, systemPrompt, type LlmSchemaName } from "../src/index.js";

const dir = join(__dirname, "../../../spec/contracts/llm");

describe("rules mirror", () => {
  it("matches spec/contracts/llm purpose + rules exactly (re-run gen-rules.py on drift)", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(Object.keys(llmContracts).length);
    for (const f of files) {
      const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
      expect(llmRules[d.name]).toEqual({ purpose: d.purpose ?? "", rules: d.rules ?? [] });
    }
  });
  it("puts each contract's purpose and rules into the system prompt", () => {
    for (const n of Object.keys(llmContracts) as LlmSchemaName[]) {
      const p = systemPrompt(n);
      for (const r of llmContract(n).rules ?? []) expect(p).toContain(r);
    }
  });
});
