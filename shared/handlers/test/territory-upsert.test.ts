import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl } from "../src/territory-upsert";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const audits = (t: ReturnType<typeof kit>) => t.db.audit_event.all();

describe("fn:territory-upsert (REQ-SET-003, REQ-CORE-010)", () => {
  it("admin creates a territory with reps and a free postal code; one audit", async () => {
    const t = kit();
    const used = new Set((await t.db.territory_postal_code.all()).map((c) => c.postal_code));
    const free = (await t.db.postal_area.all()).find((p) => !used.has(p.postal_code));
    const codes = free ? [free.postal_code] : [];
    const body = { name: "East", manager_id: IDS.eleni, default_rep_id: IDS.dimitra, postal_codes: codes, rep_ids: [IDS.nikos] };
    expect(validateRequest("territory-upsert", body).ok).toBe(true);
    const r = ok(await handle(t.fnCtx("thanasis", body)));
    expect(validateResponse("territory-upsert", r).ok).toBe(true);
    expect((await t.db.territory_rep.all({ territory_id: r.territory_id })).map((l) => l.user_id).sort()).toEqual([IDS.nikos, IDS.dimitra].sort());
    expect((await t.db.territory_postal_code.all({ territory_id: r.territory_id })).map((c) => c.postal_code)).toEqual(codes);
    const a = await audits(t);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ action: "settings_change", target_table: "territory", target_id: r.territory_id });
  });

  it("manager edits own territory: rep set replaced, postal code of another territory is a conflict", async () => {
    const t = kit();
    const north = (await t.db.territory.get(IDS.north))!;
    const codes = (await t.db.territory_postal_code.all({ territory_id: IDS.north })).map((c) => c.postal_code);
    ok(await handle(t.fnCtx("eleni", { territory_id: IDS.north, name: north.name, default_rep_id: IDS.nikos, postal_codes: codes, rep_ids: [IDS.nikos] })));
    expect((await t.db.territory_rep.all({ territory_id: IDS.north })).map((l) => l.user_id)).toEqual([IDS.nikos]);
    const centerCode = (await t.db.territory_postal_code.findOne({ territory_id: IDS.center }))!.postal_code;
    const out = await handle(t.fnCtx("eleni", { territory_id: IDS.north, name: north.name, postal_codes: [...codes, centerCode], rep_ids: [IDS.nikos] }));
    expect(errCode(out)).toBe("conflict");
    expect(await audits(t)).toHaveLength(1);
  });

  it("rep forbidden (territories.manage); manager cannot edit a territory they do not manage", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("nikos", { name: "X", postal_codes: [], rep_ids: [], caller: { role: "admin" } })))).toBe("forbidden");
    const other = (await t.db.territory.all()).find((x) => x.manager_id !== IDS.eleni);
    if (other) expect(errCode(await handle(t.fnCtx("eleni", { territory_id: other.id, name: other.name, postal_codes: [], rep_ids: [] })))).toBe("forbidden");
    expect(errCode(await runAsTool("territory-upsert", impl, t.toolCtx("nikos"), { name: "X", postal_codes: [], rep_ids: [] }, t.key))).toBe("forbidden");
  });

  it("functions/territory-upsert/handler.gen.js is the current bundle (run `pnpm bundle territory-upsert` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "territory-upsert", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("territory-upsert"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
