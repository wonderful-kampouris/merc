// The only coupling to @merc/contracts: plain schema data + generated types.
// Imported by relative path (not the package index) so runtime bundles do not
// pull in Ajv, mocks or seed data.
import { llm, defs } from "../../../packages/contracts/src/generated/schemas.js";
import { llmRules } from "./rules.generated.js";
import type { ApiError, LlmSchemaName, LlmInputMap, LlmOutputMap } from "../../../packages/contracts/src/generated/types.js";

export type { ApiError, LlmSchemaName, LlmInputMap, LlmOutputMap };

export interface LlmContract {
  name: string;
  profile: ProfileKey;
  purpose?: string;
  rules?: string[];
  input: JsonSchema;
  output: JsonSchema;
}
export type ProfileKey = "merc-extract" | "merc-write" | "merc-decide";
export type JsonSchema = Record<string, unknown>;

export const llmContracts = llm as Record<string, LlmContract>;
export const defSchemas = defs as Record<string, JsonSchema>;

export function llmContract(name: LlmSchemaName): LlmContract {
  const c = llmContracts[name];
  if (!c) throw new Error(`unknown llm schema: ${name}`);
  const r = llmRules[name];
  return r ? { ...c, purpose: c.purpose ?? r.purpose, rules: c.rules ?? r.rules } : c;
}
