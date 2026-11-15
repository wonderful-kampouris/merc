import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAsTool, validateRequest, validateResponse } from "../../core/src/index";
import { handle, impl } from "../src/contact-export";
import { kit, ok, errCode, IDS } from "../src/_lib/testkit";
import { bundleText, FUNCTIONS } from "../src/_lib/bundle";

const audits = (t: ReturnType<typeof kit>) => t.db.audit_event.all();

const MILTOS_CONTACT = "416bbb0b-46bb-5b8d-be2c-d5cc354b6142";

describe("fn:contact-export (REQ-SET-004, REQ-CORE-010)", () => {
  it("exports the contact with activities and messages; one audit row without PII", async () => {
    const t = kit();
    const r = ok(await handle(t.fnCtx("thanasis", { contact_id: MILTOS_CONTACT })));
    expect(validateResponse("contact-export", r).ok).toBe(true);
    expect((r.export as any).contact.full_name).toBe("Miltos Papadakis");
    expect(Array.isArray((r.export as any).activities)).toBe(true);
    const a = await audits(t);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ action: "contact_export", target_table: "contact", target_id: MILTOS_CONTACT });
    expect(a[0].detail).not.toMatch(/Miltos|@/);
  });
  it("human-only admin: managers, reps and the tool path are forbidden; unknown contact not_found", async () => {
    const t = kit();
    expect(errCode(await handle(t.fnCtx("eleni", { contact_id: MILTOS_CONTACT })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("nikos", { contact_id: MILTOS_CONTACT, caller: { role: "admin" } })))).toBe("forbidden");
    expect(errCode(await handle(t.fnCtx("thanasis", { contact_id: "00000000-0000-4000-8000-000000000000" })))).toBe("not_found");
    expect(errCode(await runAsTool("contact-export", impl, t.toolCtx("nikos"), { contact_id: MILTOS_CONTACT }, t.key))).toBe("forbidden");
  });

  it("functions/contact-export/handler.gen.js is the current bundle (run `pnpm bundle contact-export` after changes)", async () => {
    const committed = readFileSync(join(FUNCTIONS, "contact-export", "handler.gen.js"), "utf8");
    expect(committed === (await bundleText("contact-export"))).toBe(true);
    expect(committed).not.toMatch(/from\s*["']node:/);
  });
});
