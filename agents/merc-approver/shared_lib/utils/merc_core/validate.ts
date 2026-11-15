// Dependency-free JSON-schema validator for the contract subset (type, properties, required,
// additionalProperties, items, enum, anyOf, format, $ref). No Ajv: no codegen/eval, so it runs in any
// Wonderful runtime. Adds the REQ-CORE-007 unit rules: *_minor is an integer, *_pct is 0..100.
import { defs, functions } from "./generated/contracts/schemas";
import type { ApiError, FunctionSlug, FunctionRequestMap, FunctionResponseMap } from "./generated/contracts/types";

export type Schema = Record<string, any>;
export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[]; error: ApiError };

const FORMATS: Record<string, RegExp> = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^\d{4}-\d{2}-\d{2}$/,
  "date-time": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
};

function deref(s: Schema): Schema {
  if (typeof s.$ref !== "string") return s;
  const m = /#\/\$defs\/([A-Za-z0-9_]+)$/.exec(s.$ref);
  const d = m ? (defs as Record<string, Schema>)[m[1]!] : undefined;
  if (!d) throw new Error(`unresolved $ref ${s.$ref}`);
  return d;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function typeOk(t: string, v: unknown): boolean {
  switch (t) {
    case "object": return isObj(v);
    case "array": return Array.isArray(v);
    case "string": return typeof v === "string";
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "boolean": return typeof v === "boolean";
    case "null": return v === null;
    default: throw new Error(`unsupported schema type ${t}`);
  }
}

/** REQ-CORE-007 unit rules keyed on the field name. */
export function unitErrors(key: string | undefined, v: unknown, path: string): string[] {
  if (!key || typeof v !== "number") return [];
  if (key.endsWith("_minor") && !Number.isInteger(v)) return [`${path}: money (*_minor) must be an integer in minor units`];
  // A *_delta_pct is a signed difference of percentages ("Aroma offered 15% less" -> -15).
  if (key.endsWith("_delta_pct")) return v < -100 || v > 100 ? [`${path}: percentage delta (*_delta_pct) must be -100..100`] : [];
  if (key.endsWith("_pct") && (v < 0 || v > 100)) return [`${path}: percentage (*_pct) must be 0-100`];
  return [];
}

/** Unit rules for values that have no field schema (e.g. generic `{type: object}` payloads). */
function unitScan(v: unknown, path: string, key?: string): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => unitScan(x, `${path}[${i}]`, key));
  if (isObj(v)) return Object.entries(v).flatMap(([k, x]) => unitScan(x, `${path}.${k}`, k));
  return unitErrors(key, v, path);
}

export function check(schema: Schema, v: unknown, path = "$", key?: string): string[] {
  const s = deref(schema);
  if (Array.isArray(s.anyOf)) {
    const branches = s.anyOf.map((b: Schema) => check(b, v, path, key));
    if (!branches.some((e: string[]) => e.length === 0)) return [`${path}: matches no allowed shape (${branches.map((e: string[]) => e[0]).join(" | ")})`];
    return [];
  }
  if (s.type !== undefined && !(Array.isArray(s.type) ? s.type : [s.type]).some((t: string) => typeOk(t, v))) return [`${path}: expected ${s.type}`];
  const errs: string[] = [...unitErrors(key, v, path)];
  if (Array.isArray(s.enum) && !s.enum.includes(v)) errs.push(`${path}: must be one of ${s.enum.join(", ")}`);
  if (typeof v === "string" && s.format && FORMATS[s.format] && !FORMATS[s.format]!.test(v)) errs.push(`${path}: not a valid ${s.format}`);
  if (isObj(v)) {
    const props: Record<string, Schema> = s.properties ?? {};
    for (const r of s.required ?? []) if (!(r in v) || v[r] === undefined) errs.push(`${path}.${r}: required`);
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) continue;
      if (props[k]) errs.push(...check(props[k]!, val, `${path}.${k}`, k));
      else if (s.additionalProperties === false) errs.push(`${path}.${k}: unknown field`);
      else if (isObj(s.additionalProperties)) errs.push(...check(s.additionalProperties, val, `${path}.${k}`, k));
      else errs.push(...unitScan(val, `${path}.${k}`, k));
    }
  }
  if (Array.isArray(v)) v.forEach((item, i) => errs.push(...(s.items ? check(s.items, item, `${path}[${i}]`, key) : unitScan(item, `${path}[${i}]`, key))));
  return errs;
}

export function validateSchema<T = unknown>(schema: Schema, value: unknown): Validation<T> {
  const errors = check(schema, value);
  if (errors.length === 0) return { ok: true, value: value as T };
  return { ok: false, errors, error: { code: "validation_failed", message: errors.slice(0, 3).join("; "), details: { errors } } };
}

export interface FunctionContract {
  slug: FunctionSlug;
  method: "GET" | "POST";
  gate: string | null;
  callers: string[];
  scope?: string;
  request: Schema;
  response: Schema;
  reads: string[];
  writes: string[];
}

export function contract(slug: FunctionSlug): FunctionContract {
  const c = (functions as Record<string, FunctionContract>)[slug];
  if (!c) throw new Error(`unknown function contract: ${slug}`);
  return c;
}

/** GET query strings arrive as strings: convert top-level scalars to the declared type. */
function coerce(schema: Schema, body: unknown): unknown {
  if (!isObj(body)) return body;
  const props: Record<string, Schema> = deref(schema).properties ?? {};
  const out: Record<string, unknown> = { ...body };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v !== "string" || !props[k]) continue;
    const p = deref(props[k]!);
    const types: string[] = (p.anyOf ?? [p]).map((b: Schema) => deref(b).type).flat();
    if (v === "" && types.includes("null")) out[k] = null;
    else if ((types.includes("integer") || types.includes("number")) && v.trim() !== "" && !Number.isNaN(Number(v))) out[k] = Number(v);
    else if (types.includes("boolean") && (v === "true" || v === "false")) out[k] = v === "true";
    else if (types.includes("null") && v === "null") out[k] = null;
  }
  return out;
}

export function validateRequest<S extends FunctionSlug>(slug: S, body: unknown, opts: { coerce?: boolean } = {}): Validation<FunctionRequestMap[S]> {
  const c = contract(slug);
  const b = body === undefined || body === null ? {} : body;
  return validateSchema(c.request, opts.coerce ? coerce(c.request, b) : b);
}

export function validateResponse<S extends FunctionSlug>(slug: S, body: unknown): Validation<FunctionResponseMap[S]> {
  return validateSchema(contract(slug).response, body);
}

export function validateDef<T = unknown>(name: string, value: unknown): Validation<T> {
  return validateSchema({ $ref: `../_defs.json#/$defs/${name}` }, value);
}

export const validateError = (value: unknown): Validation<ApiError> => validateDef<ApiError>("Error", value);
