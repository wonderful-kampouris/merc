import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POLICY_NAME, policyBody, sendTargets, verifyPolicy } from "../src/policy.ts";
import { FREEZE_CUT, PASS_PCT, ROOT, batchOutcomes, discover, gate, judgeAgentFiles, judgeLlm, type Suite } from "../src/eval-gate.ts";

const HASH = "sha256:" + "a".repeat(64);
const schema = {
  connections: [
    { id: "c-merc", name: "merc-gmail", actions: [{ action_key: "google_workspace_gmail_message_send", classification: "write", input_schema_hash: HASH }, { action_key: "google_workspace_profile_get", classification: "read", input_schema_hash: HASH }] },
    { id: "c-other", name: "team-x-gmail", actions: [{ action_key: "google_workspace_gmail_message_send", input_schema_hash: HASH }] },
    { id: "c-off", name: "merc-outlook", actions: [{ action_key: "send_mail", input_schema_hash: HASH, enabled: false }] },
  ],
};

describe("external-send policy", () => {
  it("targets every send action on merc-* connections only, never reads", () => {
    expect(sendTargets(schema)).toEqual([{ connection_id: "c-merc", action_key: "google_workspace_gmail_message_send", input_schema_hash: HASH }]);
  });
  it("is an enforced, global, approval-required action policy with no evaluator (every send)", () => {
    const p = policyBody(schema);
    expect(p).toMatchObject({ name: POLICY_NAME, policy_target: "action", scope: "global", mode: "enforce", active: true });
    expect(p.definition).toMatchObject({ schema_version: 1, evaluators: [], effect: { outcome: "require_approval" } });
    expect(p).not.toHaveProperty("channels");
    expect(p).not.toHaveProperty("condition");
  });
  it("refuses to build an empty net or a target without a valid schema hash", () => {
    expect(() => sendTargets({ connections: [] })).toThrow(/nothing to govern/);
    expect(() => sendTargets({ connections: [{ id: "x", name: "merc-gmail", actions: [{ action_key: "google_workspace_gmail_message_send", input_schema_hash: "stale" }] }] })).toThrow(/input_schema_hash/);
  });
  it("verify catches a read-back that dropped a target or the approval", () => {
    const p = policyBody(schema);
    expect(verifyPolicy(p, p)).toEqual([]);
    expect(verifyPolicy(p, { ...p, definition: { ...p.definition, effect: { outcome: "block" }, selectors: { origins: [], action_targets: [] } } })).toEqual(["effect.outcome", "missing target google_workspace_gmail_message_send@c-merc"]);
  });
});

describe("eval gate (REQ-OPS-004)", () => {
  it("discovers one suite per agent contract and per LLM schema with an eval set", () => {
    const s = discover();
    const agents = readdirSync(join(ROOT, "spec/contracts/agents")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    expect(s.filter((x) => x.kind === "agent").map((x) => x.suite)).toEqual(agents.sort());
    expect(s.map((x) => x.suite)).toEqual(expect.arrayContaining(["merc-buddy", "debrief_extraction"]));
    expect(s.find((x) => x.suite === "merc-buddy")!.required).toBe(true);
    expect(s.find((x) => x.suite === "debrief_extraction")!.required).toBe(true);
    for (const n of FREEZE_CUT) expect(s.find((x) => x.suite === n)?.required ?? false).toBe(false);
  });

  it("counts scenario outcomes in a batch result regardless of nesting", () => {
    expect(batchOutcomes({ results: [{ scenario_slug: "a", verdict: "PASS" }, { scenario_slug: "b", verdict: "fail" }, { scenario: "c", passed: true }] })).toEqual({ passed: 2, total: 3 });
    expect(batchOutcomes({ data: { runs: [{ scenario_id: "x", success: false }] } })).toEqual({ passed: 0, total: 1 });
    expect(batchOutcomes({})).toEqual({ passed: 0, total: 0 });
  });

  const llmSuite = (summary: Record<string, unknown> | null, ageH = 1): Suite => {
    const dir = mkdtempSync(join(tmpdir(), "qa02-gate-"));
    if (summary) {
      mkdirSync(join(dir, "reports"));
      const f = join(dir, "reports", "dev-1.json");
      writeFileSync(f, JSON.stringify({ summary }));
      const t = (Date.now() - ageH * 3_600_000) / 1000;
      utimesSync(f, t, t);
    }
    return { suite: "x", kind: "llm", dir, required: true };
  };
  it("an LLM suite passes at the bar, and fails below it, with invented numbers, or with a stale report", () => {
    expect(judgeLlm(llmSuite({ field_level_pct: PASS_PCT, invented_numbers: 0 })).status).toBe("pass");
    expect(judgeLlm(llmSuite({ field_level_pct: 87.5, invented_numbers: 0 })).status).toBe("fail");
    expect(judgeLlm(llmSuite({ field_level_pct: 95, invented_numbers: 1 })).status).toBe("fail");
    expect(judgeLlm(llmSuite({ checks: 10, passed: 10 }, 48)).status).toBe("fail");
    expect(judgeLlm(llmSuite(null)).status).toBe("missing");
    expect(judgeLlm({ suite: "y", kind: "llm", dir: "/nonexistent/qa02", required: true }).status).toBe("missing");
  });

  it("an agent without batches is missing; a missing or failing required suite blocks, a freeze-cut one only warns", () => {
    expect(judgeAgentFiles({ suite: "z", kind: "agent", dir: "/nonexistent/qa02", required: true }).result!.status).toBe("missing");
    const g = gate([
      { suite: "merc-buddy", kind: "agent", status: "missing", detail: "", required: true },
      { suite: "merc-approver", kind: "agent", status: "fail", detail: "", required: false },
      { suite: "debrief_extraction", kind: "llm", status: "pass", detail: "", required: true },
    ]);
    expect(g.pass).toBe(false);
    expect(g.blocking.map((r) => r.suite)).toEqual(["merc-buddy"]);
    expect(g.warnings.map((r) => r.suite)).toEqual(["merc-approver"]);
    expect(gate([{ suite: "a", kind: "llm", status: "pass", detail: "", required: true }, { suite: "b", kind: "agent", status: "fail", detail: "", required: false }]).pass).toBe(true);
  });

  it("promote-demo.sh stops before deploy.sh when the gate fails (today: buddy evals are missing)", () => {
    const r = spawnSync(join(ROOT, "infra/governance/promote-demo.sh"), ["agent:merc-buddy"], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("is NOT promoted to demo");
    expect(r.stdout + r.stderr).not.toContain("component:"); // deploy.sh never printed its plan header
  });

  it("the gate CLI exits non-zero while a required suite fails", () => {
    expect(() => execFileSync("node", ["--experimental-strip-types", "--no-warnings", join(ROOT, "infra/governance/src/eval-gate.ts"), "--only", "merc-buddy"], { encoding: "utf8", stdio: "pipe" })).toThrow();
  });
});
