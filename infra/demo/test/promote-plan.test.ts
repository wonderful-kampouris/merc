import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { components, gate, runbook, type Manifest } from "../src/promote-plan.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const m = JSON.parse(readFileSync(resolve(ROOT, "infra/demo/promotion.json"), "utf8")) as Manifest;

test("gate: blocks an empty demo env and a demo env equal to dev", () => {
  assert.equal(gate({ dev: { profile: "p", workspace: "A" } }, "demo").ok, false);
  assert.match(gate({ dev: { profile: "p", workspace: "A" }, demo: { profile: "p", workspace: "A" } }, "demo").why, /equals dev/);
  assert.equal(gate({ dev: { profile: "p", workspace: "A" }, demo: { profile: "p", workspace: "B" } }, "demo").ok, true);
});

test("manifest: every J5 function and cron has a monorepo folder; crons are cron functions", () => {
  for (const f of [...m.functions, ...m.crons]) assert.ok(existsSync(resolve(ROOT, "functions", f, "config.json")), f);
  for (const f of m.crons) assert.equal(JSON.parse(readFileSync(resolve(ROOT, "functions", f, "config.json"), "utf8")).kind, "cron", f);
  for (const f of ["previsit-briefs-due", "postvisit-prompts-due", "debrief-confirm-send", "debrief-process", "feedback-record", "buddy-call-start"])
    assert.ok([...m.functions, ...m.crons].includes(f), f);
});

test("runbook: ordered, backend before agent before app, never pushes in the plan itself", () => {
  const c = components(m);
  assert.ok(c.indexOf("agent:merc-buddy") > c.indexOf("fn:debrief-process"));
  assert.equal(c.at(-1), "app");
  const seen: string[] = [];
  const lines = runbook(m, "demo", { profile: "hackathon", workspace: "W" }, (x) => { seen.push(x); return `plan:\n  mode:       plan-only\n`; });
  assert.deepEqual(seen, c);
  const text = lines.join("\n");
  const at = (s: string) => text.indexOf(s);
  assert.ok(at("## 1. Tables") < at("## 2. Seed") && at("## 2. Seed") < at("## 6. Functions") && at("## 6.") < at("## 7. Monitors"));
  assert.ok(!/--push/.test(text.split("## deploy.sh --print-plan")[1]), "per-component plans are plan-only");
  assert.ok(!/^\s*infra\/demo\/reset-demo\.sh --env dev/m.test(text), "no dev commands in the demo runbook");
});
