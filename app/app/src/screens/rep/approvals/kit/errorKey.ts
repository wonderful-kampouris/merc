import { MercApiError } from "../../../../lib/client";

export type ErrorKey =
  | "err.not_found"
  | "err.forbidden"
  | "err.validation_failed"
  | "err.needs_confirmation"
  | "err.conflict"
  | "err.upstream_failed"
  | "err.timeout"
  | "err.blocked_by_policy"
  | "err.unknown";

/** i18n key for an error thrown by `client.call` (contract Error.code), or the generic one. */
export function getErrorKey(e: unknown): ErrorKey {
  return e instanceof MercApiError ? (`err.${e.code}` as ErrorKey) : "err.unknown";
}

/** Technical detail shown under the friendly message. */
export function getErrorDetail(e: unknown): string {
  if (e instanceof MercApiError) return `${e.code} · ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
