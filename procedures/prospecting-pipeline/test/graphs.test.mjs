// Structural checks of the prospecting-pipeline Procedures against contracts/procedures/prospecting-pipeline.json.
//   node --test procedures/prospecting-pipeline/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROCEDURES, renderGraph } from "../scripts/deploy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "../../..");
const contract = JSON.parse(readFileSync(join(ROOT, "spec/contracts/procedures/prospecting-pipeline.json"), "utf8"));
const vars = { AGENT_MERC_RESEARCH_ID: "agent-x", CHILD_DEDUPE_ID: "child-dedupe", CHILD_RESEARCH_ID: "child-research" };
const graphs = Object.fromEntries(PROCEDURES.map((p) => [p.name, renderGraph(p.file, vars)]));
const pipeline = graphs["merc-prospecting-pipeline"], dedupe = graphs["merc-prospecting-dedupe-one"], research = graphs["merc-prospecting-research-one"];

/** Contract step order, flattened: functions and agents as they run. */
function contractOrder(steps, out = []) {
  for (const s of steps) {
    if (s.type === "function") out.push(`fn:${s.function}`);
    if (s.type === "agent_task") out.push(`agent:${s.agent}`);
    for (const k of ["steps", "then"]) if (s[k]) contractOrder(s[k], out);
  }
  return out;
}
/** Graph order, following edges from the trigger (yes-arm first) and descending into for_each children. */
function graphOrder(g, out = []) {
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const walk = (id) => {
    if (seen.has(id)) return; seen.add(id);
    const n = byId[id];
    if (n.kind === "function") out.push(`fn:${n.config.slug}`);
    if (n.kind === "agent") out.push(n.config.agent_id === "agent-x" ? "agent:merc-research" : `agent:${n.config.agent_id}`);
    if (n.kind === "for_each") graphOrder(n.config.procedure_id === "child-dedupe" ? dedupe : research, out);
    const next = g.edges.filter((e) => e.from === id).sort((a, b) => (a.port === "no") - (b.port === "no"));
    for (const e of next) walk(e.to);
  };
  walk(g.nodes.find((n) => n.kind === "trigger").id);
  return out;
}

test("the graphs run the contract steps in the contract order", () => {
  assert.deepEqual(graphOrder(pipeline), contractOrder(contract.steps));
});

test("every function step is a procedure-callable contract with a function folder", () => {
  for (const g of Object.values(graphs)) for (const n of g.nodes.filter((x) => x.kind === "function")) {
    const c = JSON.parse(readFileSync(join(ROOT, "spec/contracts/functions", `${n.config.slug}.json`), "utf8"));
    assert.ok(c.callers.includes("procedure"), `${n.config.slug} callers ${c.callers}`);
    assert.equal(c.gate, null, `${n.config.slug} must have no gate (system caller)`);
    assert.ok(existsSync(join(ROOT, "functions", n.config.slug, "config.json")), `functions/${n.config.slug}`);
    assert.deepEqual(Object.keys(n.config.params), Object.keys(c.request.properties).filter((k) => (c.request.required ?? []).includes(k)));
  }
});

test("well-formed: one trigger with input_schema, edges between real nodes, branch yes/no, children typed and returning one schema", () => {
  for (const [name, g] of Object.entries(graphs)) {
    const ids = new Set(g.nodes.map((n) => n.id));
    const triggers = g.nodes.filter((n) => n.kind === "trigger");
    assert.equal(triggers.length, 1, name);
    assert.equal(triggers[0].config.input_schema.type, "object", name);
    for (const e of g.edges) assert.ok(ids.has(e.from) && ids.has(e.to), `${name} edge ${e.from}->${e.to}`);
    for (const b of g.nodes.filter((n) => n.kind === "branch")) assert.deepEqual(g.edges.filter((e) => e.from === b.id).map((e) => e.port).sort(), ["no", "yes"]);
    const returns = g.nodes.filter((n) => n.kind === "return");
    if (name !== "merc-prospecting-pipeline") {
      assert.ok(returns.length >= 1, `${name} needs a return`);
      for (const r of returns) assert.deepEqual(r.config.output_schema, returns[0].config.output_schema);
      const terminals = g.nodes.filter((n) => !g.edges.some((e) => e.from === n.id));
      assert.ok(terminals.every((n) => n.kind === "return"), `${name}: every terminal is a return`);
    }
  }
  assert.equal(pipeline.nodes.find((n) => n.kind === "trigger").config.programmatic_invocation_enabled, true);
});

test("dedupe runs serially (in-search duplicates are flagged once); research only for still-new candidates", () => {
  const loops = pipeline.nodes.filter((n) => n.kind === "for_each");
  assert.equal(loops[0].config.procedure_id, "child-dedupe");
  assert.equal(loops[0].config.max_concurrency, 1);
  assert.equal(loops[1].config.procedure_id, "child-research");
  const br = research.nodes.find((n) => n.kind === "branch");
  assert.deepEqual(br.config.conditions, [{ left: "{{trigger-1.candidate.row.status}}", op: "==", right: "new" }]);
  const yes = research.edges.find((e) => e.from === br.id && e.port === "yes").to;
  assert.equal(research.nodes.find((n) => n.id === yes).kind, "agent");
});

test("renderGraph refuses a missing placeholder", () => {
  assert.throws(() => renderGraph("pipeline.json", {}), /no value/);
});
