export { callStructured, runtimeModel, systemPrompt } from "./structured.js";
export type { CallOptions, CallResult, ChatModelLike, ModelFactory, StructuredRunnable, ChatMessage } from "./structured.js";
export { PROFILE_IDS, profileRef } from "./profiles.js";
export { llmContract, llmContracts, defSchemas } from "./contracts.js";
export type { ApiError, LlmSchemaName, LlmInputMap, LlmOutputMap, ProfileKey, LlmContract } from "./contracts.js";
export { validateSchema, derefSchema, schemaKeywords } from "./schema.js";
export { normalizeText, evidenceInUtterance, extractNumbers, numberInText, numbersNotInEvidence, unknownNumbers } from "./evidence.js";
export { enforceDebriefEvidence } from "./debrief.js";
export type { DebriefOutput, Dropped, EnforceResult } from "./debrief.js";

import { profileRef } from "./profiles.js";
/** Decision model on the merc-decide profile (criterion ratings, yes/no gates). Runtime-only. */
export function decisionModel(): unknown {
  const MP = (globalThis as unknown as { ModelProfiles?: { DecisionModel: new (o: { profile: string }) => unknown } }).ModelProfiles;
  if (!MP) throw new Error("ModelProfiles runtime global is not available");
  return new MP.DecisionModel({ profile: profileRef("merc-decide") });
}
