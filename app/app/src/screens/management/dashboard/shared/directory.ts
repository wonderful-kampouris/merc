import { useEffect, useState } from "react";
import { seedRows, type FunctionResponseMap } from "../../../../contracts";
import type { MercClient } from "../../../../lib/client";

/**
 * Names and pick-lists for ids the management screens' functions return bare (`items: object[]`).
 *
 * Reps and territories come from `fn:team-list` and `fn:territories-list` (in the dashboard, pipeline, targets
 * and competition function lists of app.json). Until they answer, or when they fail, labels fall back to the
 * deterministic contract seed (same ids on dev and demo), so a slow roster never blanks the filters. Accounts
 * and competitors have no list function on these screens and always come from the seed. Unknown ids render
 * as a short id (callers decide).
 */
export interface DirEntry {
  id: string;
  name: string;
}
export type DirKind = "territory" | "user" | "competitor" | "account";
export interface Directory {
  territories: DirEntry[];
  reps: DirEntry[];
  competitors: DirEntry[];
  /** Where reps and territories came from: the live functions, or the seed fallback. */
  source: "live" | "seed";
  name(kind: DirKind, id: unknown): string | undefined;
  /** Territory of an account (for signals whose row has no territory). */
  accountTerritory(accountId: unknown): string | undefined;
}

export type TeamItem = FunctionResponseMap["team-list"]["items"][number];
export interface LiveDirectory {
  team?: readonly TeamItem[];
  territories?: readonly Record<string, unknown>[];
}

export const DIRECTORY_FUNCTIONS = ["team-list", "territories-list"] as const;

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const byName = (a: DirEntry, b: DirEntry) => a.name.localeCompare(b.name);

const seedEntries = (table: string, label: string): DirEntry[] =>
  seedRows(table)
    .filter((r) => str(r.id) && str(r[label]))
    .map((r) => ({ id: r.id as string, name: r[label] as string }));

/** Active reps of a team-list reply, sorted by name. */
export function liveReps(team: readonly TeamItem[]): DirEntry[] {
  return team
    .filter((m) => m.user.role === "rep" && m.status !== "inactive")
    .map((m) => ({ id: m.user.id, name: m.user.full_name }))
    .sort(byName);
}

/** Named territories of a territories-list reply (`items: object[]`), sorted by name. */
export function liveTerritories(rows: readonly Record<string, unknown>[]): DirEntry[] {
  return rows
    .filter((r) => str(r.id) && str(r.name))
    .map((r) => ({ id: r.id as string, name: r.name as string }))
    .sort(byName);
}

/**
 * The directory from the live replies, falling back per list to the seed when a reply is missing or empty.
 * Name lookups try the live names first, then the seed (so a manager's roster still labels other users).
 */
export function buildDirectory(live: LiveDirectory = {}): Directory {
  const seedUsers = seedRows("app_user");
  const seedReps = seedUsers
    .filter((u) => u.role_code === "rep" && u.status !== "inactive" && str(u.id))
    .map((u) => ({ id: u.id as string, name: String(u.full_name) }));
  const lReps = live.team ? liveReps(live.team) : [];
  const lTerr = live.territories ? liveTerritories(live.territories) : [];
  const reps = lReps.length ? lReps : seedReps;
  const territories = lTerr.length ? lTerr : seedEntries("territory", "name");
  const competitors = seedEntries("competitor", "name");
  const accounts = seedRows("account");

  const users = new Map(seedUsers.map((u) => [u.id as string, String(u.full_name)]));
  live.team?.forEach((m) => users.set(m.user.id, m.user.full_name));
  const terr = new Map(seedEntries("territory", "name").map((e) => [e.id, e.name]));
  lTerr.forEach((e) => terr.set(e.id, e.name));
  const maps: Record<DirKind, Map<string, string>> = {
    territory: terr,
    user: users,
    competitor: new Map(competitors.map((e) => [e.id, e.name])),
    account: new Map(accounts.map((a) => [a.id as string, String(a.name)])),
  };
  const accTerr = new Map(accounts.map((a) => [a.id as string, a.territory_id as string | undefined]));
  return {
    territories,
    reps,
    competitors,
    source: lReps.length || lTerr.length ? "live" : "seed",
    name: (kind, id) => (typeof id === "string" ? maps[kind].get(id) : undefined),
    accountTerritory: (id) => (typeof id === "string" ? accTerr.get(id) ?? undefined : undefined),
  };
}

let cached: Directory | undefined;

/** The seed-only directory (first paint and the fallback). */
export function directory(): Directory {
  return (cached ??= buildDirectory());
}

/**
 * Fetch team-list and territories-list once (each only when the screen's app.json lists it) and merge them over
 * the seed. A failing call keeps the seed for that list; it never throws.
 */
export async function loadDirectory(client: Pick<MercClient, "call">, functions: readonly string[]): Promise<Directory> {
  const has = (slug: string) => functions.includes(slug);
  const [team, territories] = await Promise.all([
    has("team-list") ? client.call("team-list", {}).then((r) => r.items, () => undefined) : undefined,
    has("territories-list") ? client.call("territories-list", {}).then((r) => r.items as Record<string, unknown>[], () => undefined) : undefined,
  ]);
  return buildDirectory({ team, territories });
}

/** The directory for a screen: the seed at first render, the live one as soon as both calls settle. */
export function useDirectory(client: Pick<MercClient, "call">, functions: readonly string[]): Directory {
  const [dir, setDir] = useState<Directory>(directory);
  const key = functions.join(",");
  useEffect(() => {
    const functions = key.split(",");
    let alive = true;
    void loadDirectory(client, functions).then((d) => alive && setDir(d));
    return () => {
      alive = false;
    };
  }, [client, key]);
  return dir;
}
