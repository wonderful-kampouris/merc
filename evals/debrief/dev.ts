// Shared helpers for the dev eval scripts: wful calls (dev workspace only) and client-side row listing.
import { execFileSync } from "node:child_process";

export const WS = "7b52cbc0-4e7d-5fc4-a2df-a76f5ecae464"; // dev (infra/deploy/environments.json)
const BASE = ["--profile", "hackathon", "--workspace", WS];

export function wful(args: string[], input?: string): string {
  return execFileSync("wful", [...BASE, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, input, stdio: ["pipe", "pipe", "pipe"] });
}
export function wfulJson<T = any>(args: string[]): T {
  const out = wful(args);
  return JSON.parse(out) as T;
}
/** Every row of a merc table (paged), as plain row objects with `id`, `created_at`. Filtering is done by the caller. */
export function rows(table: string): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  for (let page = 1; page < 200; page++) {
    const r = wfulJson<{ data: Array<{ id: string; data: Record<string, any>; created_at: number }> }>(["tables", "row-list", `merc.${table}`, "--json", "--limit", "500", "--page", String(page)]);
    const items = r.data ?? [];
    for (const x of items) out.push({ ...x.data, id: x.data.id ?? x.id, code: x.data.code, created_at: x.created_at });
    if (items.length < 500) break;
  }
  return out;
}
export const insert = (table: string, data: Record<string, unknown>) => wfulJson(["tables", "row-insert", `merc.${table}`, "--data", JSON.stringify(data), "--json"]);
export const update = (table: string, id: string, data: Record<string, unknown>) => wfulJson(["tables", "row-update", `merc.${table}`, id, "--data", JSON.stringify(data), "--json"]);
export const del = (table: string, id: string) => wful(["tables", "row-delete", `merc.${table}`, id, "--force"]);

/** POST a function on dev as the signed-in platform user; returns the unwrapped result and the wall time. */
export function callFn(slug: string, body: unknown): { ms: number; out: any } {
  const t0 = Date.now();
  let raw: string;
  try { raw = wful(["call", "post", `/api/v1/functions/${slug}`, "--data", JSON.stringify(body)]); }
  catch (e: any) { raw = String(e?.stdout ?? "") || JSON.stringify({ error: { code: "upstream_failed", message: String(e?.stderr ?? e).slice(0, 400) } }); }
  const ms = Date.now() - t0;
  let j: any; try { j = JSON.parse(raw); } catch { j = { error: { code: "upstream_failed", message: raw.slice(0, 400) } }; }
  // fn:debrief-process answers {status, result, candidates, question} at the top level (wful already unwraps {data}).
  return { ms, out: j };
}
export function getFn(slug: string, query: Record<string, string>): any {
  const q = new URLSearchParams(query).toString();
  return JSON.parse(wful(["call", "get", `/api/v1/functions/${slug}?${q}`]));
}

export const athensDate = (iso: string | number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
export function arg(name: string): string | null { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? null : null; }
export const flag = (name: string) => process.argv.includes(`--${name}`);
