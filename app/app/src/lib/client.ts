import {
  callMock,
  ERROR_STATUS,
  functionContract,
  validateError,
  validateRequest,
  validateResponse,
  type ApiError,
  type FunctionRequestMap,
  type FunctionResponseMap,
  type FunctionSlug,
  type MockOptions,
} from "../contracts";

/** The slice of the app SDK's `api` the client needs (`useWonderful().api`). */
export interface FunctionInvoker {
  invokeFunction<T = unknown>(
    slug: string,
    options?: { method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"; params?: Record<string, unknown> },
  ): Promise<T>;
}

export class MercApiError extends Error {
  readonly code: ApiError["code"];
  readonly status: number;
  readonly details: unknown;
  constructor(
    readonly slug: string,
    err: ApiError,
  ) {
    super(`${slug}: ${err.message}`);
    this.name = "MercApiError";
    this.code = err.code;
    this.status = ERROR_STATUS[err.code] ?? 500;
    this.details = err.details;
  }
}

export interface ClientOptions {
  invoker: FunctionInvoker;
  /** Answer every call from @merc/contracts mock handlers instead of the platform. */
  mock: boolean;
  /** App slug used to folder-qualify function slugs (`merc/<slug>`). */
  appSlug?: string;
  mockOptions?: MockOptions;
  /** When set, only these slugs may be called (a screen's function list, REQ-APP-001). */
  allowed?: readonly string[];
}

export type CallFn = <S extends FunctionSlug>(slug: S, body?: FunctionRequestMap[S]) => Promise<FunctionResponseMap[S]>;

export interface MercClient {
  readonly mock: boolean;
  call: CallFn;
  /** A client limited to one screen's functions. */
  forScreen(functions: readonly string[]): MercClient;
}

type Unwrapped = { result: unknown } | { error: ApiError };

/** Accept the platform wrapper `{result, logs}` / `{error}`, or a bare result if the SDK already unwrapped it. */
export function unwrap(raw: unknown): Unwrapped {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const keys = Object.keys(raw);
    if (keys.length === 1 && keys[0] === "error") {
      const e = validateError((raw as { error: unknown }).error);
      return { error: e.ok ? e.value : { code: "upstream_failed", message: "malformed error response", details: { errors: e.errors } } };
    }
    if (keys.includes("result") && keys.every((k) => k === "result" || k === "logs")) return { result: (raw as { result: unknown }).result };
  }
  return { result: raw };
}

/** Map a thrown SDK/HTTP error to an ApiError, using the contract Error body when there is one. */
export function toApiError(e: unknown): ApiError {
  const o = (e ?? {}) as Record<string, unknown>;
  for (const c of [o.body, o.data, o.response, o.error, o]) {
    if (c && typeof c === "object" && "error" in c) {
      const v = validateError((c as { error: unknown }).error);
      if (v.ok) return v.value;
    }
  }
  const message = e instanceof Error ? e.message : String(e);
  if (/not permitted|forbidden|\b403\b/i.test(message)) return { code: "forbidden", message };
  if (/timed? ?out|\b504\b/i.test(message)) return { code: "timeout", message };
  return { code: "upstream_failed", message };
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export function createClient(opts: ClientOptions): MercClient {
  const appSlug = opts.appSlug ?? "merc";
  const call: CallFn = async (slug, body) => {
    const fail = (err: ApiError): never => {
      throw new MercApiError(slug, err);
    };
    if (opts.allowed && !opts.allowed.includes(slug)) fail({ code: "forbidden", message: `${slug} is not listed for this screen` });
    const contract = functionContract(slug);
    const method = String(contract.method).toUpperCase();
    if (method === "WS") fail({ code: "validation_failed", message: `${slug} is a WebSocket function; use the live channel` });
    const params = clone(body ?? {}) as Record<string, unknown>;
    const req = validateRequest(slug, params, { coerce: method === "GET" });
    if (!req.ok) fail(req.error);

    let reply: Unwrapped;
    if (opts.mock) {
      reply = callMock(slug, params, opts.mockOptions);
    } else {
      try {
        reply = unwrap(await opts.invoker.invokeFunction(`${appSlug}/${slug}`, { method: method as "GET" | "POST", params }));
      } catch (e) {
        reply = { error: toApiError(e) };
      }
    }
    if ("error" in reply) return fail(reply.error);
    const res = validateResponse(slug, reply.result);
    if (!res.ok) return fail(res.error);
    return res.value;
  };
  return { mock: opts.mock, call, forScreen: (functions) => createClient({ ...opts, allowed: functions }) };
}
