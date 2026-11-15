import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { llmContracts, defSchemas, validateSchema, derefSchema, schemaKeywords, type LlmSchemaName } from "../src/index.js";
import { validateLlmOutput, validateLlmInput } from "../../../packages/contracts/src/validate.js";
import { mockLlmOutput } from "../../../packages/contracts/src/mock.js";

const names = Object.keys(llmContracts) as LlmSchemaName[];
const SUPPORTED = ["type", "properties", "required", "additionalProperties", "items", "enum", "anyOf", "format", "$ref", "description", "title", "$defs", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"];

describe("mini validator", () => {
  it("covers every llm contract in spec/contracts/llm and every keyword they use", () => {
    const onDisk = readdirSync(new URL("../../../spec/contracts/llm/", import.meta.url)).filter((f) => f.endsWith(".json"));
    expect(names.length).toBe(onDisk.length);
    for (const n of names) {
      const kw = schemaKeywords([llmContracts[n].input, llmContracts[n].output, defSchemas]);
      for (const k of kw) if (!/^[A-Z]/.test(k)) expect(SUPPORTED, `${n} uses ${k}`).toContain(k);
    }
  });

  it("agrees with Ajv on valid mock outputs and on broken ones", () => {
    for (const n of names) {
      const good = mockLlmOutput(n) as Record<string, unknown>;
      expect(validateLlmOutput(n, good).ok).toBe(true);
      expect(validateSchema(llmContracts[n].output, good, defSchemas)).toEqual([]);
      const req = (llmContracts[n].output.required as string[])[0];
      const missing = { ...good }; delete missing[req];
      const extra = { ...good, zz_extra: 1 };
      const wrongType = { ...good, [req]: 12345 };
      for (const bad of [missing, extra, wrongType, null, "text"]) {
        expect(validateLlmOutput(n, bad).ok, `${n} ajv`).toBe(false);
        expect(validateSchema(llmContracts[n].output, bad, defSchemas).length, `${n} mini`).toBeGreaterThan(0);
      }
    }
  });

  it("checks formats, integers and $ref defs like Ajv", () => {
    const s = llmContracts.debrief_extraction.input;
    const base = { utterance: "x", today: "2026-11-15", account: { id: "11111111-1111-4111-8111-111111111111", name: "A", account_type: "customer" }, open_problems: [], open_deals: [], products: [], active_campaigns: [], contacts: [], competitors: [] };
    expect(validateSchema(s, base, defSchemas)).toEqual([]);
    expect(validateLlmInput("debrief_extraction", base).ok).toBe(true);
    const cases = [
      { ...base, today: "15/11/2026" },
      { ...base, account: { ...base.account, id: "nope" } },
      { ...base, account: { ...base.account, account_type: "vip" } },
      { ...base, open_deals: [{ deal_id: base.account.id, title: "d", stage_code: "s", amount_minor: 12.5 }] },
    ];
    for (const c of cases) {
      expect(validateLlmInput("debrief_extraction", c).ok).toBe(false);
      expect(validateSchema(s, c, defSchemas).length).toBeGreaterThan(0);
    }
  });

  it("derefSchema inlines every $ref", () => {
    for (const n of names) expect(JSON.stringify(derefSchema(llmContracts[n].input, defSchemas))).not.toContain("$ref");
  });
});
