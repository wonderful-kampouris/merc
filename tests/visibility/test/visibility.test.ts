// REQ-CORE-009 across the whole function surface (WP-QA-02).
// "Rep A cannot read rep B's account outside a shared territory, by app or by voice."
// Data-driven: every contract function with scope `account` that takes an `account_id` is called for every
// (user, account) pair of the demo seed, through the deployed entry (`handle`, app path) and, when the buddy
// may call it, through `runAsTool` with signed claims (voice path). The expected answer is computed from the
// seed alone (owner or territory member; manager: team; admin: all), never from the code under test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAsTool, signIdentity, type FunctionContext, type ToolContext } from "../../../shared/core/src/index";
import { kit, errCode, ok, IDS, DEMO_DAY } from "../../../shared/handlers/src/_lib/testkit";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const C = join(ROOT, "spec/contracts");
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));

interface Contract { slug: string; method: string; scope: string | null; callers: string[]; request: { properties?: Record<string, unknown>; required?: string[] } }
const contracts: Contract[] = readdirSync(join(C, "functions")).filter((f) => f.endsWith(".json")).map((f) => ({ slug: f.slice(0, -5), ...json(join(C, "functions", f)) }));

// Account-scoped single-account reads: the surface where a cross-territory leak would show.
// Writes (POST) are exercised for the main write paths below; LLM-only paths are excluded only if they
// cannot run without a model (none of the GET reads need one before the scope check).
export const ACCOUNT_READS = contracts
  .filter((c) => c.method === "GET" && c.scope === "account" && c.request.properties && "account_id" in c.request.properties)
  .filter((c) => (c.request.required ?? []).every((r) => r === "account_id"))
  .map((c) => c.slug)
  .sort();

// --- seed truth ------------------------------------------------------------------------------------------
const seed = (t: string) => json(join(C, "seed", `${t}.json`)) as Array<Record<string, any>>;
const users = seed("app_user");
const accounts = seed("account");
const territoryReps = seed("territory_rep");
const territories = seed("territory");
const key = (u: Record<string, any>) => String(u.wonderful_user_id).replace("@wuid:", "");
const byKey = Object.fromEntries(users.map((u) => [key(u), u]));
const repKeys = users.filter((u) => u.role_code === "rep").map(key);

function reportsOf(managerId: string): Set<string> {
  const out = new Set<string>();
  const walk = (id: string) => users.filter((u) => u.manager_id === id).forEach((u) => { if (!out.has(u.id)) { out.add(u.id); walk(u.id); } });
  walk(managerId);
  return out;
}
/** Expected visibility, from the SPEC text alone. */
export function canSee(userKey: string, acc: Record<string, any>): boolean {
  const u = byKey[userKey]!;
  if (u.role_code === "admin") return true;
  if (u.role_code === "manager") {
    const team = reportsOf(u.id);
    const managed = new Set(territories.filter((t) => t.manager_id === u.id).map((t) => t.id));
    return acc.owner_rep_id === u.id || team.has(acc.owner_rep_id) || managed.has(acc.territory_id);
  }
  const mine = new Set(territoryReps.filter((r) => r.user_id === u.id).map((r) => r.territory_id));
  return acc.owner_rep_id === u.id || mine.has(acc.territory_id);
}

// --- contexts for any seeded user (the kit only names four) ------------------------------------------------
type K = ReturnType<typeof kit>;
const appCtx = (t: K, who: string, data: unknown): FunctionContext =>
  ({ tables: t.tables, data, secrets: t.platform.secrets, globals: t.platform.globals, metadata: { workspaceId: t.platform.workspaceId, user: { id: `wuid-${who}`, email: `${who}@merc.test`, role: "user", tenantId: "t" } } }) as unknown as FunctionContext;
const voiceCtx = (t: K, who: string): ToolContext =>
  ({ tables: t.tables, secrets: t.platform.secrets, globals: t.platform.globals, metadata: { communication: { metadata: signIdentity(t.key, { app_user_id: byKey[who]!.id, org_id: IDS.org }) } } }) as unknown as ToolContext;

const handlers: Record<string, { handle: (c: unknown) => Promise<unknown>; impl: any }> = {};
// Handlers with outbound deps (LLM, KB) export makeImpl(deps) instead of impl. The scope check runs before any
// dep is used, so inert deps are enough: they fail loudly if a forbidden call ever reached them.
const inertDeps = { pitch: async () => ({ ok: false, error: "no-llm-in-test" }), bullets: async () => ({ ok: false, error: "no-llm-in-test" }), kb: async () => [], now: () => Date.now(), log: () => {} };
async function load(slug: string) {
  if (!handlers[slug]) {
    const m: any = await import(`../../../shared/handlers/src/${slug}.ts`);
    handlers[slug] = { handle: m.handle, impl: m.impl ?? (m.makeImpl ? m.makeImpl(m.defaultDeps ? { ...m.defaultDeps(null, { secrets: { get: () => null }, globals: { get: () => null } }), ...inertDeps } : inertDeps) : undefined) };
  }
  return handlers[slug]!;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${DEMO_DAY}T08:00:00Z`)); });
afterEach(() => { vi.useRealTimers(); });

describe("seed sanity (the matrix is only meaningful if reps really differ)", () => {
  it("there are reps in at least two territories, and two reps share one", () => {
    const terr = new Map<string, string[]>();
    for (const r of territoryReps) terr.set(r.territory_id, [...(terr.get(r.territory_id) ?? []), r.user_id]);
    expect(terr.size).toBeGreaterThanOrEqual(2);
    expect([...terr.values()].some((v) => v.length >= 2)).toBe(true);
    expect(accounts.some((a) => canSee("nikos", a)) && accounts.some((a) => !canSee("nikos", a))).toBe(true);
  });
  it("the read surface covers the main account screens and buddy tools", () => {
    expect(ACCOUNT_READS).toEqual(expect.arrayContaining(["account-get", "visit-card-get"]));
  });
});

describe.each(ACCOUNT_READS)("fn:%s enforces territory visibility", (slug) => {
  const contract = contracts.find((c) => c.slug === slug)!;
  const viaVoice = contract.callers.includes("buddy");
  it(`app path${viaVoice ? " and voice path" : ""}: forbidden exactly when the seed says so`, async () => {
    const t = kit();
    const { handle, impl } = await load(slug);
    const mismatches: string[] = [];
    let denied = 0, allowed = 0;
    for (const who of [...repKeys, "eleni", "thanasis"]) {
      for (const acc of accounts) {
        const expectSee = canSee(who, acc);
        const app = errCode(await handle(appCtx(t, who, { account_id: acc.id })));
        if ((app === "forbidden") === expectSee) mismatches.push(`app ${who} -> ${acc.name}: got ${app ?? "ok"}, expected ${expectSee ? "visible" : "forbidden"}`);
        if (viaVoice && byKey[who]!.role_code === "rep") {
          const voice = errCode(await runAsTool(slug as any, impl, voiceCtx(t, who), { account_id: acc.id }, t.key));
          if ((voice === "forbidden") === expectSee) mismatches.push(`voice ${who} -> ${acc.name}: got ${voice ?? "ok"}`);
        }
        expectSee ? allowed++ : denied++;
      }
    }
    expect(mismatches).toEqual([]);
    expect(denied).toBeGreaterThan(0);
    expect(allowed).toBeGreaterThan(0);
  }, 60_000);
});

describe("lists never return another territory's rows", () => {
  it("accounts-list: each rep sees exactly the seed-visible set", async () => {
    const { handle } = await load("accounts-list");
    const t = kit();
    for (const who of repKeys) {
      const r: any = ok(await handle(appCtx(t, who, { limit: 200 })));
      const got = new Set((r.items ?? r.accounts ?? r.rows).map((a: any) => a.id ?? a.account_id));
      const want = new Set(accounts.filter((a) => a.org_id === IDS.org && canSee(who, a)).map((a) => a.id));
      for (const id of got) expect(want.has(id), `${who} sees ${id}`).toBe(true);
      expect(got.size, `${who} list size`).toBe(want.size);
    }
  });

  it("accounts-list: a rep filtering on another territory gets nothing outside their scope", async () => {
    const { handle } = await load("accounts-list");
    const t = kit();
    const center = IDS.center;
    const out: any = await handle(appCtx(t, "nikos", { territory_id: center, limit: 200 }));
    if (errCode(out)) expect(errCode(out)).toBe("forbidden");
    else expect(((out.items ?? out.accounts ?? out.rows) as any[]).filter((a) => !canSee("nikos", accounts.find((x) => x.id === (a.id ?? a.account_id))!))).toEqual([]);
  });

  it.each(["deals-list", "orders-list"])("%s with another territory's account_id is forbidden for a rep", async (slug) => {
    const { handle } = await load(slug);
    const t = kit();
    const foreign = accounts.find((a) => !canSee("nikos", a))!;
    const shared = accounts.find((a) => a.owner_rep_id === byKey.dimitra!.id && canSee("nikos", a))!;
    expect(errCode(await handle(appCtx(t, "nikos", { account_id: foreign.id })))).toBe("forbidden");
    expect(errCode(await handle(appCtx(t, "nikos", { account_id: shared.id })))).not.toBe("forbidden");
  });

  it("a spoofed caller in the body never widens scope", async () => {
    const { handle } = await load("account-get");
    const t = kit();
    const foreign = accounts.find((a) => !canSee("nikos", a))!;
    expect(errCode(await handle(appCtx(t, "nikos", { account_id: foreign.id, caller: { user_id: byKey.thanasis!.id } })))).toBe("forbidden");
  });

  it("by voice, resolve_account never resolves to another territory's shop (account-resolve)", async () => {
    const { impl } = await load("account-resolve");
    const t = kit();
    for (const foreign of accounts.filter((a) => !canSee("nikos", a)).slice(0, 8)) {
      const out: any = await runAsTool("account-resolve", impl, voiceCtx(t, "nikos"), { hint: foreign.name }, t.key);
      const ids = JSON.stringify(out);
      expect(ids.includes(foreign.id), `nikos resolved ${foreign.name}`).toBe(false);
    }
    const mine = accounts.find((a) => a.owner_rep_id === byKey.nikos!.id)!;
    expect(JSON.stringify(await runAsTool("account-resolve", impl, voiceCtx(t, "nikos"), { hint: mine.name }, t.key))).toContain(mine.id);
  });

  it("a tampered voice claim gets no data", async () => {
    const { impl } = await load("visit-card-get");
    const t = kit();
    const ctx = voiceCtx(t, "nikos") as any;
    ctx.metadata.communication.metadata.merc_uid = byKey.thanasis!.id; // signature no longer matches
    const foreign = accounts.find((a) => !canSee("nikos", a))!;
    expect(errCode(await runAsTool("visit-card-get", impl, ctx, { account_id: foreign.id }, t.key))).toBe("forbidden");
  });
});

describe("account writes respect the same scope", () => {
  it("contact-upsert on another territory's account is forbidden; on a shared-territory one it is not", async () => {
    const { handle } = await load("contact-upsert");
    const t = kit();
    const foreign = accounts.find((a) => !canSee("nikos", a))!;
    const shared = accounts.find((a) => a.owner_rep_id === byKey.dimitra!.id && canSee("nikos", a))!;
    expect(errCode(await handle(appCtx(t, "nikos", { account_id: foreign.id, fields: { full_name: "Test Person" } })))).toBe("forbidden");
    expect(errCode(await handle(appCtx(t, "nikos", { account_id: shared.id, fields: { full_name: "Test Person" } })))).not.toBe("forbidden");
  });
});

describe("app permission catalog (contracts/app/app.json)", () => {
  const app = json(join(C, "app/app.json"));
  const DATA = ["accounts.read", "accounts.write", "deals.read", "orders.read", "voicelog.read", "plan.read", "dashboard.read", "tasks.read"];
  it("the rep role grants record reads only through relations, never to all rows", () => {
    const all: string[] = app.roles.rep.all;
    expect(all.filter((p) => DATA.includes(p))).toEqual([]);
    expect(app.roles.rep.relation.owner).toEqual(expect.arrayContaining(["accounts.read"]));
    expect(app.roles.rep.relation.territory_member).toEqual(expect.arrayContaining(["accounts.read"]));
  });
  it("the manager role reads records through team_manager/owner relations, not globally", () => {
    expect((app.roles.manager.all as string[]).filter((p) => DATA.includes(p))).toEqual([]);
    expect(app.roles.manager.relation.team_manager).toEqual(expect.arrayContaining(["accounts.read"]));
  });
});

describe("REQ-NFR-005 log sample review: no personal data in function logs", () => {
  it("app and voice calls (allowed and forbidden) log no seeded phone number or email", async () => {
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); }));
    try {
      const t = kit();
      const foreign = accounts.find((a) => !canSee("nikos", a))!;
      const mine = accounts.find((a) => a.owner_rep_id === byKey.nikos!.id)!;
      for (const slug of [...ACCOUNT_READS, "account-resolve"]) {
        const { handle, impl } = await load(slug);
        for (const acc of [mine, foreign]) {
          const data = slug === "account-resolve" ? { hint: acc.name } : { account_id: acc.id };
          await handle(appCtx(t, "nikos", data));
          if (impl && contracts.find((c) => c.slug === slug)!.callers.includes("buddy")) await runAsTool(slug as any, impl, voiceCtx(t, "nikos"), data, t.key);
        }
      }
    } finally { spies.forEach((s) => s.mockRestore()); }
    const pii = [...users, ...accounts, ...seed("contact")].flatMap((r) => [r.phone, r.email, r.mobile]).filter((v): v is string => typeof v === "string" && v.length > 5);
    const leaks = lines.filter((l) => pii.some((p) => l.includes(p)));
    expect(pii.length).toBeGreaterThan(20);
    expect(leaks).toEqual([]);
  });
});
