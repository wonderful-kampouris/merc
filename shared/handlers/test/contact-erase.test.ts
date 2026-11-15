import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl } from "../src/contact-erase";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const audits = (t: ReturnType<typeof kit>) => t.db.audit_event.all();
import { readdirSync } from "node:fs";

const MILTOS_CONTACT = "416bbb0b-46bb-5b8d-be2c-d5cc354b6142";
const ROOT = join(__dirname, "..", "..", "..");

describe("fn:contact-erase (REQ-SET-004, REQ-CORE-010)", () => {
  it("confirm=false -> needs_confirmation and nothing changes", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("thanasis", { contact_id: MILTOS_CONTACT, confirm: false })))).toBe("needs_confirmation");
    expect(await t.db.contact.get(MILTOS_CONTACT)).not.toBeNull();
    expect(await audits(t)).toHaveLength(0);
  });
  it("confirm=true erases the contact and writes one audit row without PII", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("thanasis", { contact_id: MILTOS_CONTACT, confirm: true })));
    expect(r).toEqual({ erased: true });
    expect(validateResponse("contact-erase", r).ok).toBe(true);
    expect(await t.db.contact.get(MILTOS_CONTACT)).toBeNull();
    const a = await audits(t);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ action: "contact_erase", target_id: MILTOS_CONTACT });
    expect(a[0].detail).not.toMatch(/Miltos|@|\+30/);
  });
  it("managers, reps and tool callers are forbidden", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("eleni", { contact_id: MILTOS_CONTACT, confirm: true })))).toBe("forbidden");
    expect(errCode(await runAsTool("contact-erase", impl, t.toolCtx("nikos"), { contact_id: MILTOS_CONTACT, confirm: true }, t.key))).toBe("forbidden");
    expect(await t.db.contact.get(MILTOS_CONTACT)).not.toBeNull();
  });
  it("no agent tool contract references contact-erase (REQ-SET-004 acceptance)", () => {
    const tools = join(ROOT, "spec", "contracts", "tools");
    for (const agent of readdirSync(tools)) for (const f of readdirSync(join(tools, agent))) {
      expect(readFileSync(join(tools, agent, f), "utf8"), `${agent}/${f}`).not.toMatch(/contact-erase|contact-export/);
    }
    expect(readFileSync(join(ROOT, "spec", "contracts", "functions", "contact-erase.json"), "utf8")).toMatch(/"callers": \[\s*"mgmt"\s*\]/);
  });

  it("functions/contact-erase/handler.gen.js is the current bundle (run `pnpm bundle contact-erase` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "contact-erase", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("contact-erase"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
