import { describe, expect, it } from "vitest";
import { createDb, dashboardRepIds, inTeam, isOwnerOrTeam, isRequesterOrApprover, listAccounts, principalFromFunction, principalFromTool, requireAccount, requireAccountRow, requirePermission, signIdentity, canSeeAccount } from "../src/index";
import { seeded, IDS, fnCtx } from "./fake-tables";

const rej = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as any; } throw new Error("expected rejection"); };

async function setup() {
  const f = seeded();
  const db = createDb(f, IDS.org);
  const accounts = await db.account.all();
  const p = (w: string) => principalFromFunction(f, fnCtx(w));
  const centerOther = accounts.find((a) => a.territory_id === IDS.center && a.owner_rep_id !== IDS.nikos)!;
  const dimitraNorth = accounts.find((a) => a.owner_rep_id === IDS.dimitra && a.territory_id === IDS.north);
  return { f, db, accounts, p, centerOther, dimitraNorth };
}

describe("role scope (REQ-CORE-009)", () => {
  it("rep sees owned and territory accounts, not another rep's account outside a shared territory", async () => {
    const { db, p, centerOther, dimitraNorth } = await setup();
    const nikos = await p("wuid-nikos");
    expect((await requireAccount(db, nikos, IDS.miltos)).name).toBe("Café Miltos");
    if (dimitraNorth) expect((await requireAccount(db, nikos, dimitraNorth.id)).id).toBe(dimitraNorth.id);
    expect(centerOther).toBeTruthy();
    expect((await rej(requireAccount(db, nikos, centerOther.id))).code).toBe("forbidden");
    expect((await rej(requireAccount(db, nikos, "00000000-0000-4000-8000-000000000009"))).code).toBe("not_found");
  });

  it("same rule by voice: the tool principal gets the same forbidden", async () => {
    const { f, db, centerOther } = await setup();
    const claims = signIdentity("k", { app_user_id: IDS.nikos, org_id: IDS.org });
    const nikos = await principalFromTool(f, { metadata: { communication: { metadata: claims } } }, "k");
    expect((await rej(requireAccount(db, nikos, centerOther.id))).code).toBe("forbidden");
  });

  it("listAccounts returns exactly the visible set per role", async () => {
    const { db, p, accounts } = await setup();
    const nikos = await p("wuid-nikos"), eleni = await p("wuid-eleni"), admin = await p("wuid-thanasis");
    const repList = await listAccounts(db, nikos, {}, { limit: 1000 });
    const expected = accounts.filter((a) => a.owner_rep_id === IDS.nikos || a.territory_id === IDS.north);
    expect(repList.total).toBe(expected.length);
    expect(repList.items.every((a) => canSeeAccount(nikos, a))).toBe(true);
    expect(repList.items.some((a) => a.territory_id === IDS.center && a.owner_rep_id !== IDS.nikos)).toBe(false);
    expect((await listAccounts(db, admin, {}, { limit: 1000 })).total).toBe(40);
    const mgr = await listAccounts(db, eleni, {}, { limit: 1000 });
    expect(mgr.total).toBeGreaterThan(repList.total);
    const customers = await listAccounts(db, nikos, { account_type: "customer" }, { limit: 1000 });
    expect(customers.items.every((a) => a.account_type === "customer")).toBe(true);
    // op-conditions and same-column conditions survive the scope sets
    const named = await listAccounts(db, nikos, { name: { op: "contains", value: "caf" } }, { limit: 1000 });
    expect(named.items.length).toBeGreaterThan(0);
    expect(named.items.every((a) => a.name.toLowerCase().includes("caf") && canSeeAccount(nikos, a))).toBe(true);
    const ownNotNull = await listAccounts(db, nikos, { owner_rep_id: { op: "is_not_null" } }, { limit: 1000 });
    expect(ownNotNull.items.every((a) => a.owner_rep_id != null)).toBe(true);
    const onlyDimitra = await listAccounts(db, nikos, { owner_rep_id: IDS.dimitra }, { limit: 1000 });
    expect(onlyDimitra.items.every((a) => a.owner_rep_id === IDS.dimitra && a.territory_id === IDS.north)).toBe(true);
    const notNorth = await listAccounts(db, nikos, { territory_id: { op: "neq", value: IDS.north } }, { limit: 1000 });
    expect(notNorth.items.every((a) => a.territory_id !== IDS.north && a.owner_rep_id === IDS.nikos)).toBe(true);
    const page2 = await listAccounts(db, nikos, {}, { limit: 2, offset: 2 });
    expect(page2.items.map((a) => a.id)).toEqual(repList.items.slice(2, 4).map((a) => a.id));
  });

  it("account children are checked through their account", async () => {
    const { db, p, centerOther } = await setup();
    const nikos = await p("wuid-nikos");
    const c = await db.contact.insert({ account_id: centerOther.id, full_name: "Center Person", is_decision_maker: false } as any);
    expect((await rej(requireAccountRow(db, nikos, "contact", c.id))).code).toBe("forbidden");
    expect((await requireAccountRow(db, await p("wuid-eleni"), "contact", c.id)).id).toBe(c.id);
  });

  it("owner / owner_or_team / team / approver / dashboard helpers", async () => {
    const { p } = await setup();
    const nikos = await p("wuid-nikos"), eleni = await p("wuid-eleni"), admin = await p("wuid-thanasis");
    expect(isOwnerOrTeam(nikos, IDS.nikos)).toBe(true);
    expect(isOwnerOrTeam(nikos, IDS.dimitra)).toBe(false);
    expect(isOwnerOrTeam(eleni, IDS.dimitra)).toBe(true);
    expect(isOwnerOrTeam(eleni, IDS.thanasis)).toBe(false);
    expect(inTeam(nikos, IDS.dimitra)).toBe(false);
    expect(inTeam(eleni, IDS.nikos)).toBe(true);
    expect(inTeam(admin, IDS.eleni)).toBe(true);
    expect(isRequesterOrApprover(eleni, { approver_id: IDS.eleni, requested_by: IDS.nikos })).toBe(true);
    expect(isRequesterOrApprover(nikos, { approver_id: IDS.eleni, requested_by: IDS.nikos })).toBe(true);
    expect(isRequesterOrApprover(await p("wuid-dimitra"), { approver_id: IDS.eleni, requested_by: IDS.nikos })).toBe(false);
    expect(dashboardRepIds(nikos)).toEqual([IDS.nikos]);
    expect(dashboardRepIds(admin)).toBeNull();
    expect(dashboardRepIds(eleni)).toEqual(expect.arrayContaining([IDS.eleni, IDS.nikos]));
    expect(() => dashboardRepIds(nikos, IDS.dimitra)).toThrow(/outside your scope/);
    expect(() => requirePermission(nikos, "team.read")).toThrow(/missing permission/);
    expect(() => requirePermission(eleni, "team.read")).not.toThrow();
  });
});
