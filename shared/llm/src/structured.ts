import { defSchemas, llmContract, type ApiError, type JsonSchema, type LlmInputMap, type LlmOutputMap, type LlmSchemaName } from "./contracts.js";
import { profileRef } from "./profiles.js";
import { derefSchema, validateSchema } from "./schema.js";

/** Message shape accepted by LangChain chat models (class instances or {role, content}). */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string } | object;
export interface StructuredRunnable { invoke(messages: ChatMessage[]): Promise<unknown> }
export interface ChatModelLike { withStructuredOutput(schema: JsonSchema, opts?: { method?: string; name?: string }): StructuredRunnable }
/** Builds a chat model for a profile ref. Default: the runtime's ModelProfiles.ChatModel. */
export type ModelFactory = (profile: string) => ChatModelLike;

export interface CallOptions {
  /** Extra, call-specific instructions appended to the system prompt. */
  instructions?: string;
  /** Override the contract's profile (key or tenant UUID). */
  profile?: string;
  /** Inject a model (tests, or a non-default runtime). */
  model?: ModelFactory;
  /** Total attempts including the first; the WP contract is 2 (retry once). */
  maxAttempts?: number;
  temperature?: number;
}

export type CallResult<T> =
  | { ok: true; value: T; attempts: number; profile: string; logs: string[] }
  | { ok: false; error: ApiError; attempts: number; profile: string; logs: string[] };

type Runtime = {
  ModelProfiles?: { ChatModel: new (o: { profile: string; temperature?: number }) => ChatModelLike };
  LangChainCore?: Record<string, new (content: string) => object>;
};
const rt = () => globalThis as unknown as Runtime;

export const runtimeModel = (temperature = 0): ModelFactory => (profile) => {
  const MP = rt().ModelProfiles;
  if (!MP) throw new Error("ModelProfiles runtime global is not available (pass opts.model outside Wonderful Functions)");
  return new MP.ChatModel({ profile, temperature });
};

function message(role: "system" | "user" | "assistant", content: string): ChatMessage {
  const core = rt().LangChainCore;
  const cls = core?.[role === "system" ? "SystemMessage" : role === "user" ? "HumanMessage" : "AIMessage"];
  return cls ? new cls(content) : { role, content };
}

export function systemPrompt(name: LlmSchemaName, instructions?: string): string {
  const c = llmContract(name);
  const lines = [
    `You are the "${name}" step of Merc, a field-sales CRM.`,
    c.purpose ? `Task: ${c.purpose}` : "",
    "Input is a JSON object. Answer only with a JSON object that matches the output schema exactly.",
    "Never invent numbers, names, ids or facts: use only what is in the input. Copy evidence quotes verbatim from the input text.",
    "Answer in the language of the input text (Greek or English) and never translate proper names.",
    ...(c.rules?.length ? ["Rules:", ...c.rules.map((r) => `- ${r}`)] : []),
    instructions ?? "",
  ];
  return lines.filter(Boolean).join("\n");
}

function asObject(raw: unknown): unknown {
  if (typeof raw === "string") {
    const s = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    try { return JSON.parse(s); } catch { return raw; }
  }
  // includeRaw-style wrappers
  if (raw && typeof raw === "object" && "parsed" in raw && "raw" in raw) return (raw as { parsed: unknown }).parsed;
  return raw;
}

const fail = (code: ApiError["code"], message: string, details?: Record<string, unknown>): ApiError => ({ code, message, ...(details ? { details } : {}) }) as ApiError;

/**
 * One structured LLM call for a contracts/llm/<name>.json schema:
 * validates the input, calls the contract's model profile with structured output,
 * validates the output, and retries once with the validation errors as feedback.
 */
export async function callStructured<N extends LlmSchemaName>(name: N, input: LlmInputMap[N], opts: CallOptions = {}): Promise<CallResult<LlmOutputMap[N]>> {
  const contract = llmContract(name);
  const profile = profileRef(opts.profile ?? contract.profile);
  const logs: string[] = [];
  const inErrs = validateSchema(contract.input, input, defSchemas);
  if (inErrs.length) {
    return { ok: false, attempts: 0, profile, logs, error: fail("validation_failed", `${name} input: ${inErrs.join("; ")}`, { errors: inErrs, stage: "input" }) };
  }
  const outSchema = { title: name, ...(derefSchema(contract.output, defSchemas) as JsonSchema) };
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
  let messages: ChatMessage[];
  try {
    messages = [message("system", systemPrompt(name, opts.instructions)), message("user", JSON.stringify(input))];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, attempts: 0, profile, logs, error: fail("upstream_failed", `${name}: could not build messages: ${msg}`, { stage: "messages" }) };
  }
  let last: ApiError = fail("upstream_failed", `${name}: no attempt made`);
  let attempts = 0;
  for (; attempts < maxAttempts; ) {
    attempts++;
    const t0 = Date.now();
    let value: unknown;
    try {
      const model = (opts.model ?? runtimeModel(opts.temperature))(profile).withStructuredOutput(outSchema, { method: "jsonSchema", name });
      value = asObject(await model.invoke(messages));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logs.push(`${name} attempt ${attempts}: model error after ${Date.now() - t0}ms: ${msg}`);
      last = fail("upstream_failed", `${name}: model call failed: ${msg}`, { stage: "model" });
      continue;
    }
    const errs = validateSchema(contract.output, value, defSchemas);
    if (!errs.length) {
      logs.push(`${name} attempt ${attempts}: ok in ${Date.now() - t0}ms (profile ${profile})`);
      return { ok: true, value: value as LlmOutputMap[N], attempts, profile, logs };
    }
    logs.push(`${name} attempt ${attempts}: output invalid: ${errs.slice(0, 5).join("; ")}`);
    last = fail("validation_failed", `${name} output: ${errs.join("; ")}`, { errors: errs, stage: "output" });
    const feedback = `Your previous answer was:\n${JSON.stringify(value)}\nIt did not match the output schema:\n${errs.slice(0, 20).join("\n")}\nReturn the corrected JSON object only.`;
    messages = [...messages.slice(0, 2), message("user", feedback)];
  }
  return { ok: false, attempts, profile, logs, error: last };
}
