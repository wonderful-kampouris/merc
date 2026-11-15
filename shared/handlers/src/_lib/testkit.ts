// Test helpers for handler WPs (not deployed): a seeded in-memory db and principal/context builders.
//   const t = kit();                       // fresh FakeTables loaded with the demo seed
//   const nikos = await t.principal("nikos");
//   const out = await handle(t.fnCtx("nikos", { ...body }));   // the deployed entry, end to end
//   const viaTool = await runAsTool(slug, impl, t.toolCtx("nikos"), params, t.key);
import { createDb, principalFromFunction, signIdentity, systemPrincipal, type Db, type FunctionContext, type PlatformLike, type SystemCaller, type ToolContext, type UserPrincipal } from "../../../core/src/index";
import { FakeTables, seeded, IDS, DEMO_DAY } from "../../../core/testing/fake-tables";

export { FakeTables, seeded, IDS, DEMO_DAY };

/** Seeded users by key: the Wonderful user id in the seed is `wuid-<key>`. */
export const USERS = { thanasis: IDS.thanasis, eleni: IDS.eleni, nikos: IDS.nikos, dimitra: IDS.dimitra } as const;
export type UserKey = keyof typeof USERS;
/** HMAC key used for tool identity in tests (never a real secret). */
export const TEST_INTERNAL_KEY = "test-internal-call-key";

export interface FakePlatformInit { secrets?: Record<string, unknown>; globals?: Record<string, unknown>; workspaceId?: string }
export function fakePlatform(init: FakePlatformInit = {}): Required<Pick<PlatformLike, "secrets" | "globals">> & { workspaceId: string } {
  const s = init.secrets ?? {}, g = init.globals ?? {};
  return {
    secrets: { get: (n: string) => (n in s ? s[n] : null) },
    globals: { get: (n: string) => (n in g ? g[n] : null) },
    workspaceId: init.workspaceId ?? "ws-test",
  };
}

export function kit(init: FakePlatformInit = {}) {
  const tables = seeded();
  const platform = fakePlatform(init);
  const db: Db = createDb(tables, IDS.org);
  const wuid = (who: UserKey | null) => (who ? `wuid-${who}` : null);
  return {
    tables, db, platform, ids: IDS, key: TEST_INTERNAL_KEY,
    /** A Wonderful Function context as the platform builds it for a signed-in app user (null = no user). */
    fnCtx(who: UserKey | null, data: unknown = {}): FunctionContext {
      const id = wuid(who);
      return { tables, data, secrets: platform.secrets, globals: platform.globals, metadata: { workspaceId: platform.workspaceId, ...(id ? { user: { id, email: `${who}@merc.test`, role: "user", tenantId: "t" } } : {}) } } as FunctionContext;
    },
    /** A buddy-tool context carrying signed Merc identity claims (as minted by fn:merc-chat-token). */
    toolCtx(who: UserKey, opts: { key?: string; ttlSeconds?: number; now?: number } = {}): ToolContext {
      const claims = signIdentity(opts.key ?? TEST_INTERNAL_KEY, { app_user_id: USERS[who], org_id: IDS.org, ttlSeconds: opts.ttlSeconds, now: opts.now });
      return { tables, secrets: platform.secrets, globals: platform.globals, metadata: { communication: { metadata: claims } } } as ToolContext;
    },
    principal: (who: UserKey): Promise<UserPrincipal> => principalFromFunction(tables, { metadata: { user: { id: wuid(who)! } } }),
    system: (caller: SystemCaller = "scheduler") => systemPrincipal(tables, IDS.org, caller),
  };
}
export type Kit = ReturnType<typeof kit>;

/** Narrow a handler outcome: throws if it is an error, so tests read `ok(await handle(...)).field`. */
export function ok<T>(out: T): Exclude<T, { error: unknown }> {
  if (out && typeof out === "object" && "error" in (out as object)) throw new Error(`expected success, got ${JSON.stringify((out as any).error)}`);
  return out as Exclude<T, { error: unknown }>;
}
/** The error code of a handler outcome (or null on success). */
export const errCode = (out: unknown): string | null => (out && typeof out === "object" && "error" in (out as object) ? (out as any).error.code : null);
