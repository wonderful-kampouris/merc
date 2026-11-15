// Minimal JSON-schema validator for the keyword subset the Merc contracts use.
// No code generation (no eval/new Function), so it runs inside the Functions
// WASM sandbox. Parity with Ajv is checked in test/schema.test.ts.
import type { JsonSchema } from "./contracts.js";

const SUPPORTED = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum", "anyOf", "format", "$ref",
  "description", "title", "$defs", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems",
]);

const FORMATS: Record<string, (s: string) => boolean> = {
  date: (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s,
  "date-time": (s) => /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)),
  time: (s) => /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})?$/.test(s),
  uuid: (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  email: (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
  uri: (s) => /^[a-z][a-z0-9+.-]*:\S+$/i.test(s),
};

function refName(ref: string): string {
  const m = /#\/\$defs\/([^/]+)$/.exec(ref);
  if (!m) throw new Error(`unsupported $ref: ${ref}`);
  return m[1];
}

function typeOk(t: string, v: unknown): boolean {
  switch (t) {
    case "null": return v === null;
    case "boolean": return typeof v === "boolean";
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "array": return Array.isArray(v);
    case "object": return typeof v === "object" && v !== null && !Array.isArray(v);
    default: throw new Error(`unsupported type: ${t}`);
  }
}

/** Returns a list of error strings (`/path message`); empty means valid. */
export function validateSchema(schema: JsonSchema, value: unknown, defs: Record<string, JsonSchema>, path = ""): string[] {
  const at = path || "/";
  for (const k of Object.keys(schema)) if (!SUPPORTED.has(k)) return [`${at} unsupported schema keyword ${k}`];
  if (typeof schema.$ref === "string") {
    const target = defs[refName(schema.$ref)];
    if (!target) return [`${at} unresolved $ref ${schema.$ref}`];
    return validateSchema(target, value, defs, path);
  }
  if (Array.isArray(schema.anyOf)) {
    const branches = (schema.anyOf as JsonSchema[]).map((s) => validateSchema(s, value, defs, path));
    if (!branches.some((e) => e.length === 0)) return [`${at} must match a schema in anyOf (${branches.map((b) => b[0]).join(" | ")})`];
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((t) => typeOk(t, value))) return [`${at} must be ${types.join("|")}`];
  }
  const errs: string[] = [];
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => e === value)) errs.push(`${at} must be one of ${JSON.stringify(schema.enum)}`);
  if (typeof value === "string") {
    if (typeof schema.format === "string") {
      const f = FORMATS[schema.format];
      if (f && !f(value)) errs.push(`${at} must match format "${schema.format}"`);
    }
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errs.push(`${at} must have length >= ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errs.push(`${at} must have length <= ${schema.maxLength}`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errs.push(`${at} must be >= ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errs.push(`${at} must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errs.push(`${at} must have >= ${schema.minItems} items`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errs.push(`${at} must have <= ${schema.maxItems} items`);
    if (schema.items && typeof schema.items === "object") value.forEach((item, i) => errs.push(...validateSchema(schema.items as JsonSchema, item, defs, `${path}/${i}`)));
  }
  if (typeOk("object", value)) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const r of (schema.required ?? []) as string[]) if (!(r in obj)) errs.push(`${at} must have required property '${r}'`);
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) errs.push(...validateSchema(props[k], v, defs, `${path}/${k}`));
      else if (schema.additionalProperties === false) errs.push(`${at} must NOT have additional properties (${k})`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errs.push(...validateSchema(schema.additionalProperties as JsonSchema, v, defs, `${path}/${k}`));
    }
  }
  return errs;
}

/** Inline every $ref so the schema can be handed to a provider's structured-output API. */
export function derefSchema(schema: unknown, defs: Record<string, JsonSchema>, seen: string[] = []): unknown {
  if (Array.isArray(schema)) return schema.map((s) => derefSchema(s, defs, seen));
  if (!schema || typeof schema !== "object") return schema;
  const s = schema as JsonSchema;
  if (typeof s.$ref === "string") {
    const name = refName(s.$ref);
    if (seen.includes(name)) throw new Error(`recursive $ref ${name}`);
    return derefSchema(defs[name], defs, [...seen, name]);
  }
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === "enum" ? v : derefSchema(v, defs, seen)]));
}

/** Keywords used anywhere in a schema tree (for the coverage test). */
export function schemaKeywords(schema: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) schema.forEach((s) => schemaKeywords(s, out));
  else if (schema && typeof schema === "object") {
    for (const [k, v] of Object.entries(schema)) {
      out.add(k);
      if (k === "properties" || k === "$defs") Object.values(v as object).forEach((s) => schemaKeywords(s, out));
      else if (k !== "enum") schemaKeywords(v, out);
    }
  }
  return out;
}
