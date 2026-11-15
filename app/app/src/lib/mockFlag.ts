import { readQuery, readStored, writeStored } from "./storage";

export const MOCK_KEY = "merc.mock";

/**
 * Mock mode is on when, in order of precedence: the URL has `?mock=1` (or `?mock=0` turns it off),
 * the stored preference is "1", or the build sets VITE_MERC_MOCK=1. Off by default.
 */
export function resolveMockFlag(input: { query: string | null; stored: string | null; env?: string }): boolean {
  if (input.query === "1" || input.query === "true") return true;
  if (input.query === "0" || input.query === "false") return false;
  if (input.stored !== null) return input.stored === "1";
  return input.env === "1" || input.env === "true";
}

export function readMockFlag(): boolean {
  const query = readQuery("mock");
  const on = resolveMockFlag({ query, stored: readStored(MOCK_KEY), env: import.meta.env?.VITE_MERC_MOCK as string | undefined });
  if (query !== null) writeStored(MOCK_KEY, on ? "1" : "0");
  return on;
}

export function storeMockFlag(on: boolean): void {
  writeStored(MOCK_KEY, on ? "1" : "0");
}
