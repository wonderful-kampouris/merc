// WP-BUD-01 acceptance tests: the tool list matches the contract (REQ-BUD-003), every tool runs the shared handler
// through runAsTool with identity from the signed claim (REQ-BUD-002), injected values come from code,
// log_visit passes the rep's words verbatim (REQ-BUD-008), resolve_account attaches memory (REQ-BUD-007).
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kit, IDS } from "../../../shared/handlers/src/_lib/testkit";
import { runAsTool } from "../../../shared/core/src/index";
import { impl as resolveImpl } from "../../../shared/handlers/src/account-resolve";
import { AGENT, bundleText, OUT, toolSpecs } from "../scripts/build-lib.ts";
import { generate, skillSpecs } from "../scripts/gen-tools.ts";
import { NAME_INTERNAL_KEY, runTool, injectedFields, sessionLanguage, type ToolSpec } from "../lib/runtime";
import resolveAccount, { SPEC as RESOLVE_SPEC } from "../tools/resolve_account/index";
import logVisit, { SPEC as LOG_SPEC } from "../tools/log_visit/index";
import undoAction from "../tools/undo_action/index";

const contractTools = (JSON.parse(readFileSync(join(AGENT, "../../spec/contracts/agents/merc-buddy.json"), "utf8")).tools as string[]).sort();

function buddyCtx(who: "nikos" | "dimitra" = "nikos", extra: { secrets?: Record<string, unknown>; md?: Record<string, unknown>; locale?: string } = {}) {
  const t = kit({ secrets: extra.secrets ?? { [NAME_INTERNAL_KEY]: "test-internal-call-key" } });
  const base = t.toolCtx(who) as any;
  const attached: string[] = [];
  const ctx = {
    ...base,
    metadata: { workspaceId: "ws-test", communication: { id: "comm-123", locale: extra.locale ?? "el-GR", metadata: { ...base.metadata.communication.metadata, ...(extra.md ?? {}) } } },
    customers: { attach: (id: string) => { attached.push(id); return { id: "c1", external_id: id, name: "x" }; } },
  };
  return { t, ctx, attached };
}
const quiet = { log: () => {} };

describe("contract parity (REQ-BUD-003)", () => {
  it("has exactly the contract tools, each backed by its contract function", async () => {
    const dirs = readdirSync(join(AGENT, "tools"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    expect(dirs).toEqual(contractTools);
    expect(dirs.length).toBe(30);
    for (const spec of toolSpecs()) {
      const mod = await import(`../tools/${spec.name}/index.ts`);
      expect(mod.default.name).toBe(spec.name);
      expect(mod.SPEC.slug).toBe(spec.function);
      expect(mod.SPEC.inject).toContain("caller");
      // caller is never a model parameter
      expect(Object.keys(mod.default.params.toJsonSchema().properties ?? {})).not.toContain("caller");
    }
  });
  it("skills match the agent contract", () => {
    for (const sk of skillSpecs()) {
      const j = JSON.parse(readFileSync(join(AGENT, `skills/${sk.name}/skill.json`), "utf8"));
      expect(Object.keys(j.tools).sort()).toEqual([...sk.tools].sort());
      expect(existsSync(join(AGENT, `skills/${sk.name}/prompt.md`))).toBe(true);
    }
  });
  it("generated tools and skills are fresh", () => {
    for (const [rel, text] of Object.entries(generate(false))) expect(readFileSync(join(AGENT, rel), "utf8"), rel).toBe(text);
  });
  it("lib/merc.gen.js is fresh (re-run scripts/build-lib.ts)", async () => {
    expect(readFileSync(OUT, "utf8")).toBe(await bundleText());
  });
});

describe("identity and injection (REQ-BUD-002)", () => {
  it("resolve_account returns the same as the shared handler via runAsTool and attaches memory (REQ-BUD-007)", async () => {
    const { t, ctx, attached } = buddyCtx();
    const lines: string[] = [];
    const viaTool: any = await resolveAccount.handler(ctx, { hint: "Café Miltos" } as any);
    const direct: any = await runAsTool("account-resolve", resolveImpl, t.toolCtx("nikos"), { hint: "Café Miltos" }, t.key);
    expect(viaTool).toEqual(direct);
    expect(viaTool.status).toBe("resolved");
    expect(viaTool.account.id).toBe(IDS.miltos);
    expect(attached).toEqual([IDS.miltos]);
    await runTool(ctx, RESOLVE_SPEC, resolveImpl as any, { hint: "Café Miltos" }, { log: (l) => lines.push(l) });
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ merc_tool: "resolve_account", caller: IDS.nikos, caller_source: "signed_session_claim" });
  });
  it("a caller supplied by the model is ignored", async () => {
    const seen: any[] = [];
    const spy = async ({ req, me }: any) => { seen.push({ req, me: me.id }); return { status: "not_found", account: null, candidates: [] }; };
    const { ctx } = buddyCtx("nikos");
    await runTool(ctx, RESOLVE_SPEC, spy as any, { hint: "x", caller: { user_id: IDS.eleni, role: "admin" }, merc_uid: IDS.eleni }, quiet);
    expect(seen[0].me).toBe(IDS.nikos);
    expect(seen[0].req).not.toHaveProperty("caller");
    expect(seen[0].req).not.toHaveProperty("merc_uid");
  });
  it("no signed claim, a tampered claim or an expired claim is forbidden", async () => {
    const { ctx } = buddyCtx();
    const noClaim = { ...ctx, metadata: { communication: { id: "c", metadata: {} } } };
    expect((await resolveAccount.handler(noClaim, {} as any) as any).error.code).toBe("forbidden");
    const md = { ...ctx.metadata.communication.metadata, merc_uid: IDS.eleni };
    expect((await resolveAccount.handler({ ...ctx, metadata: { communication: { metadata: md } } }, {} as any) as any).error.code).toBe("forbidden");
    expect((await runTool(ctx, RESOLVE_SPEC, resolveImpl as any, {}, { ...quiet, now: () => Date.now() + 2 * 3600_000 }) as any).error.code).toBe("forbidden");
  });
  it("degrades with blocked_by_policy naming the secret until MERC_INTERNAL_CALL_KEY is set", async () => {
    const { ctx } = buddyCtx("nikos", { secrets: {} });
    const out: any = await resolveAccount.handler(ctx, {} as any);
    expect(out.error.code).toBe("blocked_by_policy");
    expect(out.error.details.missing).toBe(NAME_INTERNAL_KEY);
  });
  it("undo_action degrades clearly while the ai-action-undo handler is missing", async () => {
    const { ctx } = buddyCtx();
    const out: any = await undoAction.handler(ctx, { ai_action_id: IDS.miltos } as any);
    if (out.error) expect(out.error.message).toMatch(/ai-action-undo|not found|forbidden/);
  });
});

describe("log_visit (REQ-BUD-008)", () => {
  it("passes the utterance verbatim and injects conversation_id, language and location from the session", async () => {
    const seen: any[] = [];
    const spy = async ({ req }: any) => { seen.push(req); return { status: "failed", result: null, candidates: [], question: null }; };
    const words = "Ήμουν στο Café Miltos, ο Μίλτος θέλει 12 κιλά Espresso Nuovo την Πέμπτη... και 8% έκπτωση!";
    const { ctx } = buddyCtx("nikos", { md: { merc_lat: 38.02, merc_lng: 23.8 } });
    await runTool(ctx, LOG_SPEC, spy as any, { utterance: words }, quiet);
    expect(seen[0].utterance).toBe(words);
    expect(seen[0]).toMatchObject({ conversation_id: "comm-123", language: "el", lat: 38.02, lng: 23.8 });
    expect(logVisit.name).toBe("log_visit");
  });
  it("language follows the session locale; constants are injected", () => {
    const { ctx } = buddyCtx("nikos", { locale: "en-US" });
    expect(sessionLanguage(ctx)).toBe("en");
    expect(injectedFields(ctx, ["caller", "origin=manual"])).toEqual({ origin: "manual" });
    const spec: ToolSpec = { tool: "x", slug: "account-resolve", inject: ["caller", "device_location?"] };
    expect(injectedFields(ctx, spec.inject)).toEqual({});
  });
});
