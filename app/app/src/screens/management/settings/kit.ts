/**
 * Small helpers shared by the WP-APP-07 management screens (campaigns, territories, settings, users,
 * import, gdpr, ai_log). Lives in this folder because a screen WP owns only its screen folders.
 * Pure functions are unit tested in kit.test.ts; `useLoad` is the one hook.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { seedRows } from "../../../contracts";
import { MercApiError } from "../../../lib/client";

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
export const str = (o: Obj, k: string, fallback = ""): string => (typeof o[k] === "string" ? (o[k] as string) : fallback);
export const optStr = (o: Obj, k: string): string | null => (typeof o[k] === "string" && o[k] !== "" ? (o[k] as string) : null);
export const num = (o: Obj, k: string): number | null => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : null);
export const bool = (o: Obj, k: string, fallback = false): boolean => (typeof o[k] === "boolean" ? (o[k] as boolean) : fallback);
export const strArr = (o: Obj, k: string): string[] | null =>
  Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === "string") : null;
export const objArr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const isUuid = (s: string): boolean => UUID_RE.test(s.trim());
export const shortId = (id: string): string => id.slice(0, 8);

/** `create_note` -> `create note` (codes are data; shown as-is in both languages). */
export const humanize = (code: string): string => code.replace(/_/g, " ");

/** ISO date (YYYY-MM-DD) `days` after `from` (UTC). */
export function addDaysIso(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const todayIso = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** One line for an error card: `code: message` for contract errors, the message otherwise. */
export function errorText(e: unknown): string {
  if (e instanceof MercApiError) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
export const errorCode = (e: unknown): string | null => (e instanceof MercApiError ? e.code : null);

/**
 * Loose contract items (`items: object[]`) carry no guaranteed fields, so the contract mocks answer `[{}]`.
 * In mock mode only, when no item survives `valid`, fall back to the seed rows of `table` so the screen shows
 * the demo org. Live mode never invents rows.
 */
export function withMockSeed<T>(mock: boolean, parsed: T[], table: string, parse: (rows: Obj[]) => T[]): T[] {
  if (!mock || parsed.length) return parsed;
  return parse(seedRows(table) as Obj[]);
}

export type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; data: T };

/** Run `load` on mount and whenever `deps` change; `reload()` runs it again. Stale results are dropped. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): LoadState<T> & { reload: () => void } {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useCallback(() => {
    const my = ++seq.current;
    setState({ status: "loading" });
    loadRef.current().then(
      (data) => my === seq.current && setState({ status: "ready", data }),
      (error: unknown) => my === seq.current && setState({ status: "error", error }),
    );
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, deps);
  return { ...state, reload: run };
}
