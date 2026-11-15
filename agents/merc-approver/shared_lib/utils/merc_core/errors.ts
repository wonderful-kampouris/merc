// REQ-CORE-008: every failure is an Error{code,message,details?} with a stable code.
import type { ApiError } from "./generated/contracts/types";

export type ErrorCode = ApiError["code"];
export type { ApiError };

/** HTTP status per code. Must stay equal to @merc/contracts ERROR_STATUS (tested). */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  validation_failed: 422,
  needs_confirmation: 409,
  conflict: 409,
  upstream_failed: 502,
  timeout: 504,
  blocked_by_policy: 403,
};

export class MercError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | null;
  constructor(code: ErrorCode, message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = "MercError";
    this.code = code;
    this.details = details;
  }
  get status(): number {
    return ERROR_STATUS[this.code];
  }
  toApiError(): ApiError {
    return this.details ? { code: this.code, message: this.message, details: this.details } : { code: this.code, message: this.message };
  }
}

type D = Record<string, unknown> | null;
export const notFound = (m: string, d: D = null) => new MercError("not_found", m, d);
export const forbidden = (m: string, d: D = null) => new MercError("forbidden", m, d);
export const invalid = (m: string, d: D = null) => new MercError("validation_failed", m, d);
export const conflict = (m: string, d: D = null) => new MercError("conflict", m, d);
export const needsConfirmation = (m: string, d: D = null) => new MercError("needs_confirmation", m, d);
export const blocked = (m: string, d: D = null) => new MercError("blocked_by_policy", m, d);

export const isMercError = (e: unknown): e is MercError => e instanceof MercError;

/** Any thrown value -> ApiError. Unknown failures become upstream_failed (no internals leaked). */
export function toApiError(e: unknown): ApiError {
  if (isMercError(e)) return e.toApiError();
  if (e && typeof e === "object" && (e as { name?: string }).name === "TableTimeoutError") return { code: "timeout", message: "table call timed out" };
  return { code: "upstream_failed", message: e instanceof Error ? e.message : String(e) };
}

export const errorResult = (e: unknown): { error: ApiError } => ({ error: toApiError(e) });
