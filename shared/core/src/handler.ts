// One runner for every entry point (REQ-CORE-004): a Wonderful Function, an agent tool and a cron/procedure
// call the same implementation through runFunction; only the principal source differs.
import { createDb, type Db, type TablesApi } from "./tables";
import { errorResult, forbidden, type ApiError } from "./errors";
import { contract, validateRequest, validateResponse } from "./validate";
import { principalFromFunction, principalFromTool, systemPrincipal, type FunctionContextLike, type Principal, type SystemCaller, type ToolContextLike, type UserPrincipal } from "./me";
import { hasPermission } from "./scope";
import type { FunctionSlug, FunctionRequestMap, FunctionResponseMap } from "./generated/contracts/types";

/** Platform extras a handler may need besides tables (secrets, globals, fetch). Structural, all optional. */
export interface PlatformLike {
  secrets?: { get(name: string): unknown } | null;
  globals?: { get(name: string): unknown } | null;
  /** Workspace the call runs in (context.metadata.workspaceId). */
  workspaceId?: string | null;
  /** context.api: present only when the function/agent has a service account (live push, outbound calls). */
  api?: { post(path: string, options?: { body?: unknown; query?: Record<string, unknown>; headers?: Record<string, string> }): Promise<unknown> } | null;
}
export interface Invocation<S extends FunctionSlug, P extends Principal = UserPrincipal> { req: FunctionRequestMap[S]; db: Db; me: P; platform: PlatformLike }
/** A handler. App and tool entries give a UserPrincipal; system entries give a Principal (user or system). */
export type Impl<S extends FunctionSlug, P extends Principal = UserPrincipal> = (inv: Invocation<S, P>) => Promise<FunctionResponseMap[S]>;
export type Outcome<S extends FunctionSlug> = FunctionResponseMap[S] | { error: ApiError };

/** Keys that are injected identity and must never be trusted from a body. */
const INJECTED = ["caller"];
function stripInjected(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body ?? {};
  const b = { ...(body as Record<string, unknown>) };
  for (const k of INJECTED) delete b[k];
  return b;
}

export interface RunArgs<P extends Principal> { tables: TablesApi; data: unknown; principal: () => Promise<P>; platform?: PlatformLike; checkResponse?: boolean }

export async function runFunction<S extends FunctionSlug, P extends Principal>(slug: S, impl: Impl<S, P>, args: RunArgs<P>): Promise<Outcome<S>> {
  try {
    const c = contract(slug);
    const v = validateRequest(slug, stripInjected(args.data), { coerce: c.method === "GET" });
    if (!v.ok) return { error: v.error };
    const me = await args.principal();
    if (c.gate && !hasPermission(me, c.gate)) throw forbidden(`missing permission ${c.gate}`, { permission: c.gate });
    const out = await impl({ req: v.value, db: createDb(args.tables, me.org_id), me, platform: args.platform ?? {} });
    if (args.checkResponse !== false) {
      const r = validateResponse(slug, out);
      if (!r.ok) return { error: { code: "validation_failed", message: `${slug} response breaks its contract`, details: { errors: r.errors } } };
    }
    return out;
  } catch (e) {
    return errorResult(e);
  }
}

export interface FunctionContext extends FunctionContextLike, PlatformLike { data?: unknown; tables: TablesApi }
const platformOf = (c: PlatformLike & { metadata?: unknown }): PlatformLike => {
  const ws = (c.metadata as { workspaceId?: unknown } | null | undefined)?.workspaceId;
  return { secrets: c.secrets ?? null, globals: c.globals ?? null, workspaceId: typeof ws === "string" && ws ? ws : null, api: c.api ?? null };
};
/** A secret as a plain string: `Other` secrets are strings, typed ones carry value/token/api_key. Null when unset. */
export function secretString(platform: PlatformLike, name: string): string | null {
  let v: unknown;
  try { v = platform.secrets?.get(name); } catch { v = null; }
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object") for (const k of ["value", "token", "api_key", "password"]) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x === "string" && x.trim()) return x.trim();
  }
  return null;
}
/** A global variable as a non-empty string, or null. */
export function globalString(platform: PlatformLike, name: string): string | null {
  let v: unknown;
  try { v = platform.globals?.get(name); } catch { v = null; }
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Wonderful Function entry (app caller): `export default defineFunction("me", async ({ me }) => meResponse(me))`. */
export function defineFunction<S extends FunctionSlug>(slug: S, impl: Impl<S, UserPrincipal>, opts: { checkResponse?: boolean } = {}) {
  return (context: FunctionContext) =>
    runFunction(slug, impl, { tables: context.tables, data: context.data, principal: () => principalFromFunction(context.tables, context), platform: platformOf(context), ...opts });
}

export interface ToolContext extends ToolContextLike, PlatformLike { tables: TablesApi }
/** Agent tool entry: same impl as the backing Function, identity from the signed session claim. */
export function runAsTool<S extends FunctionSlug>(slug: S, impl: Impl<S, UserPrincipal>, ctx: ToolContext, params: unknown, key: string, opts: { checkResponse?: boolean } = {}) {
  return runFunction(slug, impl, { tables: ctx.tables, data: params, principal: () => principalFromTool(ctx.tables, ctx, key), platform: platformOf(ctx), ...opts });
}

/**
 * System entry (scheduler/procedure) for ONE org. The org id must come from trusted code (a cron loop over
 * organizations, or a verified internal call), never from a request field.
 */
export function runAsSystem<S extends FunctionSlug>(
  slug: S,
  impl: Impl<S, Principal>,
  args: { tables: TablesApi; data: unknown; orgId: string; caller?: SystemCaller; platform?: PlatformLike; checkResponse?: boolean },
) {
  const { orgId, caller, ...rest } = args;
  return runFunction(slug, impl, { ...rest, principal: () => systemPrincipal(args.tables, orgId, caller ?? "scheduler") });
}

/** Cron entry: runs the impl once per organization with a system principal; one org failing does not stop the others. */
export function defineCron<S extends FunctionSlug>(slug: S, impl: Impl<S, Principal>, opts: { checkResponse?: boolean } = {}) {
  return async (context: FunctionContext & { data?: unknown }) => {
    const orgs = await createDb(context.tables).organization.all();
    const runs: Array<{ org_id: string; outcome: Outcome<S> }> = [];
    for (const o of orgs) runs.push({ org_id: o.id, outcome: await runAsSystem(slug, impl, { tables: context.tables, data: context.data ?? {}, orgId: o.id, platform: platformOf(context), ...opts }) });
    return { slug, orgs: runs.length, failed: runs.filter((r) => r.outcome && typeof r.outcome === "object" && "error" in (r.outcome as object)).length, runs };
  };
}
