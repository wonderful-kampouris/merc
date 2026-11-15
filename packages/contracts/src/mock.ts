import { defs, functions, events, llm } from "./generated/schemas.js";
import type { ApiError, EventType, FunctionResponseMap, FunctionSlug, LlmSchemaName, MercEvent } from "./generated/types.js";
import { seedRows, seedTables, type SeedContext, type SeedRow } from "./seed.js";
import { validateEventPayload, validateLlmOutput, validateRequest, validateResponse } from "./validate.js";

type Schema = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface MockOptions extends SeedContext {
  /** Use seed rows for values when they fit the schema (default true). */
  useSeed?: boolean;
}

/** Defs that describe a seeded table, so their fields are filled from a real seed row. */
const DEF_TABLE: Record<string, string> = {
  AccountRef: "account", UserRef: "app_user", VisitSummary: "visit", OrderSummary: "sales_order",
  AlertCard: "alert", CandidateCard: "candidate", BriefingItem: "briefing_item", Briefing: "briefing",
  DossierView: "dossier", TargetProgress: "sales_target", ApprovalCard: "approval",
};
const TABLES = new Set(seedTables());
/** `<prefix>_id` columns whose prefix is not the table name. */
const ID_ALIAS: Record<string, string> = { org: "organization", owner: "app_user", owner_rep: "app_user", rep: "app_user", manager: "app_user", user: "app_user", approver: "app_user", requested_by: "app_user" };
const idTable = (name: string): string | undefined => {
  if (!name.endsWith("_id")) return undefined;
  const p = name.slice(0, -3);
  const t = ID_ALIAS[p] ?? p;
  return TABLES.has(t) ? t : undefined;
};

const fnv = (s: string): string => {
  let out = "";
  for (let seedN = 0; out.length < 32; seedN++) {
    let h = 0x811c9dc5 ^ seedN;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out;
};
const uuidFrom = (s: string): string => {
  const h = fnv(s);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function deref(s: Schema): { s: Schema; def?: string } {
  if (s && typeof s.$ref === "string") {
    const name = /#\/\$defs\/(.+)$/.exec(s.$ref)![1]!;
    return { s: defs[name], def: name };
  }
  return { s };
}

/** Structural check over the keyword subset the contracts use. */
function matches(schema: Schema, v: unknown): boolean {
  const { s } = deref(schema);
  if (!s || Object.keys(s).length === 0) return true;
  if (s.anyOf) return s.anyOf.some((x: Schema) => matches(x, v));
  if (s.enum && !s.enum.includes(v)) return false;
  switch (s.type) {
    case "null": return v === null;
    case "boolean": return typeof v === "boolean";
    case "integer": return Number.isInteger(v);
    case "number": return typeof v === "number";
    case "string":
      if (typeof v !== "string") return false;
      if (s.format === "uuid") return UUID.test(v);
      if (s.format === "date") return /^\d{4}-\d{2}-\d{2}$/.test(v);
      if (s.format === "date-time") return /^\d{4}-\d{2}-\d{2}T/.test(v);
      return true;
    case "array": return Array.isArray(v) && v.every((x) => matches(s.items ?? {}, x));
    case "object": {
      if (!v || typeof v !== "object" || Array.isArray(v)) return false;
      const props: Schema = s.properties ?? {};
      if ((s.required ?? []).some((r: string) => !(r in v))) return false;
      return Object.entries(v).every(([k, x]) => (k in props ? matches(props[k], x) : s.additionalProperties !== false));
    }
    default: return true;
  }
}

const singular = (n: string): string => (n.endsWith("ies") ? `${n.slice(0, -3)}y` : n.endsWith("s") ? n.slice(0, -1) : n);
const tableFor = (name: string, def?: string): string | undefined => {
  if (def && DEF_TABLE[def] && TABLES.has(DEF_TABLE[def])) return DEF_TABLE[def];
  if (TABLES.has(name)) return name;
  if (TABLES.has(singular(name))) return singular(name);
  return undefined;
};

class Sampler {
  private pins = new Map<string, SeedRow>();
  private rows = new Map<string, SeedRow[]>();
  constructor(private opts: MockOptions, request: unknown, private listTable?: string) {
    if (opts.useSeed === false) return;
    if (request && typeof request === "object") {
      for (const [k, v] of Object.entries(request)) {
        const t = idTable(k);
        if (t) {
          const row = this.table(t).find((r) => r.id === v);
          if (row) this.pins.set(t, row);
        }
      }
    }
  }
  private table(t: string): SeedRow[] {
    if (this.opts.useSeed === false || !TABLES.has(t)) return [];
    let r = this.rows.get(t);
    if (!r) this.rows.set(t, (r = seedRows(t, this.opts)));
    return r;
  }
  private pick(t: string | undefined): SeedRow | undefined {
    if (!t) return undefined;
    return this.pins.get(t) ?? this.table(t)[0];
  }
  private pickMany(t: string, n: number): SeedRow[] {
    let rows = this.table(t);
    for (const [pt, prow] of this.pins) {
      const fk = `${pt}_id`;
      if (rows.length && fk in rows[0]!) rows = rows.filter((r) => r[fk] === prow.id);
    }
    return rows.slice(0, n);
  }
  private day(): Date {
    const d = this.opts.demoDay ?? new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0));
  }

  gen(schema: Schema, name: string, path: string, row?: SeedRow): unknown {
    const { s, def } = deref(schema);
    if (!s || Object.keys(s).length === 0) return null;
    if (row && name in row && matches(s, row[name])) return row[name];
    if (s.anyOf) {
      const branches: Schema[] = [...s.anyOf].sort((a, b) => Number(a.type === "null") - Number(b.type === "null"));
      return this.gen(branches[0]!, name, path, row);
    }
    if (s.enum) return s.enum[0];
    switch (s.type) {
      case "null": return null;
      case "boolean": return true;
      case "integer": return name === "limit" ? 20 : 1;
      case "number": return 1;
      case "string": return this.str(s, name, path);
      case "array": {
        const { s: item, def: itemDef } = deref(s.items ?? {});
        const t = item?.type === "object" ? (name === "items" && this.listTable ? this.listTable : tableFor(name, itemDef)) : undefined;
        if (t) {
          const rows = this.pickMany(t, 2);
          if (rows.length) return rows.map((r, i) => this.obj(item, `${path}[${i}]`, r));
        }
        return [this.gen(s.items ?? {}, singular(name), `${path}[0]`)];
      }
      case "object": {
        const t = tableFor(name, def);
        return this.obj(s, path, this.pick(t));
      }
      default: return null;
    }
  }
  private obj(s: Schema, path: string, row?: SeedRow): Record<string, unknown> {
    if (!s.properties || Object.keys(s.properties).length === 0) return s.additionalProperties === false ? {} : { ...(row ?? {}) };
    const out: Record<string, unknown> = {};
    for (const [k, ps] of Object.entries<Schema>(s.properties ?? {})) out[k] = this.gen(ps, k, `${path}.${k}`, row);
    return out;
  }
  private str(s: Schema, name: string, path: string): string {
    if (s.format === "uuid") {
      const row = this.pick(idTable(name));
      return typeof row?.id === "string" && UUID.test(row.id) ? row.id : uuidFrom(path);
    }
    if (s.format === "date") return this.day().toISOString().slice(0, 10);
    if (s.format === "date-time") return this.day().toISOString();
    if (name === "language" || name === "preferred_language") return "el";
    if (name === "currency") return "EUR";
    return `${name || "value"} sample`;
  }
}

/** `deals-list` -> `deal`, `competitor-signals-list` -> `competitor_signal`: the table behind a list's `items`. */
const listTableFor = (slug: string): string | undefined => {
  const m = /^(.+)-list$/.exec(slug);
  const t = m ? singular(m[1]!.replace(/-/g, "_")) : undefined;
  return t && TABLES.has(t) ? t : undefined;
};

type Check = { ok: true } | { ok: false; errors: string[] };

/**
 * Builds a sample seed-backed first, then seedless, and returns the first one that validates.
 * Every candidate, including the fallback, is validated: an invalid mock throws instead of leaking.
 */
export function firstValid(build: (useSeed: boolean) => unknown, check: (v: unknown) => Check, opts: MockOptions, what: string): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  const errors: string[] = [];
  for (const useSeed of opts.useSeed === false ? [false] : [true, false]) {
    const v = build(useSeed);
    const r = check(v);
    if (r.ok) return v;
    errors.push(`useSeed=${useSeed}: ${r.errors.join("; ")}`);
  }
  throw new Error(`cannot build a valid mock for ${what}: ${errors.join(" | ")}`);
}

/** A schema-valid sample `result` for a function, seed-backed where the seed fits. */
export function mockResult<S extends FunctionSlug>(slug: S, request: unknown = {}, opts: MockOptions = {}): FunctionResponseMap[S] {
  const f = functions[slug];
  if (!f) throw new Error(`unknown function slug: ${slug}`);
  return firstValid(
    (useSeed) => new Sampler({ ...opts, useSeed }, request, listTableFor(slug)).gen(f.response, "", "$"),
    (v) => validateResponse(slug, v),
    opts,
    slug,
  );
}

export type MockReply<S extends FunctionSlug> = { result: FunctionResponseMap[S]; logs: string[] } | { error: ApiError };
export type MockHandler<S extends FunctionSlug> = (body?: unknown, opts?: MockOptions) => MockReply<S>;

/** Mock a platform function call: validates the request, then returns `{result, logs}` or `{error}`. */
export function callMock<S extends FunctionSlug>(slug: S, body: unknown = {}, opts: MockOptions = {}): MockReply<S> {
  const coerce = functions[slug]?.method === "GET";
  const req = validateRequest(slug, body, { coerce });
  if (!req.ok) return { error: req.error };
  return { result: mockResult(slug, body, opts), logs: [`mock ${slug}`] };
}

/** One mock handler per function slug. */
export const mockHandlers = Object.fromEntries(
  Object.keys(functions).map((slug) => [slug, (body?: unknown, opts?: MockOptions) => callMock(slug as FunctionSlug, body ?? {}, opts)]),
) as { [S in FunctionSlug]: MockHandler<S> };

/** A schema-valid merc-live message. */
export function mockEvent<T extends EventType>(type: T, opts: MockOptions = {}): MercEvent<T> {
  const e = events[type];
  if (!e) throw new Error(`unknown event type: ${type}`);
  const payload = firstValid(
    (useSeed) => new Sampler({ ...opts, useSeed }, {}).gen(e.payload, "", "$"),
    (v) => validateEventPayload(type, v),
    opts,
    `event ${type}`,
  );
  return { type, at: (opts.demoDay ?? new Date()).toISOString(), payload: payload as MercEvent<T>["payload"] };
}

/** A schema-valid structured LLM output (for stubbing model calls in tests). */
export function mockLlmOutput(name: LlmSchemaName, opts: MockOptions = {}): unknown {
  const l = llm[name];
  if (!l) throw new Error(`unknown llm schema: ${name}`);
  return firstValid(
    (useSeed) => new Sampler({ ...opts, useSeed }, {}).gen(l.output, "", "$"),
    (v) => validateLlmOutput(name, v),
    opts,
    `llm ${name}`,
  );
}
